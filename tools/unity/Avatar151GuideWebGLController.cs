using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

public class Avatar151GuideWebGLController : MonoBehaviour
{
    public Animator animator;
    public ArmOutwardCorrection armCorrection;
    public Avatar151BlushOverlay blushOverlay;

    [Header("Animator states")]
    public string welcomeState = "welcome_wave_08";
    public string[] idleStates = Array.Empty<string>();
    public string[] thinkingStates = Array.Empty<string>();
    public string[] speakingStates = Array.Empty<string>();
    public string fallbackState = "think_looking_14";

    [Header("Timing")]
    public float crossFadeSeconds = 0.16f;
    public float welcomeSeconds = 3.35f;
    public float idleSwitchSeconds = 5.2f;
    public float thinkingSwitchSeconds = 3.25f;
    public float speakingSwitchSeconds = 4.4f;
    public float welcomeTransitionSeconds = 0.02f;
    public float idleTransitionSeconds = 0.16f;
    public float thinkingTransitionSeconds = 0.08f;
    public float speakingTransitionSeconds = 0.12f;
    public float fallbackTransitionSeconds = 0.10f;
    public float welcomeExitLeadSeconds = 0.0f;
    public float welcomePlaybackSpeed = 1.0f;
    public float idlePlaybackSpeed = 1.0f;
    public float thinkingPlaybackSpeed = 1.0f;
    public float speakingPlaybackSpeed = 1.0f;

    [Header("Clip metadata")]
    public string[] clipStateNames = Array.Empty<string>();
    public float[] clipLengths = Array.Empty<float>();
    public bool[] clipLoops = Array.Empty<bool>();

    private string currentState = "";
    private string requestedGroup = "welcome";
    private float groupElapsed;
    private float currentClipLength;
    private bool currentClipLoops;
    private float currentPlaybackSpeed = 1f;
    private int idleCursor;
    private int thinkingCursor;
    private int speakingCursor;

    private readonly List<BlendTarget> blinkTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> lowerLidTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthATargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthITargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthUTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthETargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthOTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> neutralFaceTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> closedSmileTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> blushShapeTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> tiredEyeTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> sleepyFaceTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthSmallTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthRoundTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthLargeRoundTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthWideTargets = new List<BlendTarget>();
    private readonly List<BlendTarget> mouthWide2Targets = new List<BlendTarget>();

    private float blinkElapsed;
    private float nextBlinkIn = 2.1f;
    private float idleClosedEyeElapsed;
    private float nextIdleClosedEyeIn = 4.8f;
    private float mouthElapsed;
    private float expressionBlend;
    private float blushAlpha;
    private string emotionCue = "idle";

    private void Awake()
    {
        HideHeadAccessories();
        if (animator == null) animator = GetComponentInChildren<Animator>();
        if (armCorrection == null) armCorrection = GetComponentInChildren<ArmOutwardCorrection>();
        if (blushOverlay == null) blushOverlay = GetComponent<Avatar151BlushOverlay>() ?? gameObject.AddComponent<Avatar151BlushOverlay>();
        blushOverlay.animator = animator;
        CacheBlendTargets();
    }

    private void Start()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        WebGLInput.captureAllKeyboardInput = false;
#endif
        nextBlinkIn = UnityEngine.Random.Range(2.0f, 4.0f);
        ResetIdleClosedEyeTimer(2.8f, 5.2f);
        QualitySettings.vSyncCount = 0;
        QualitySettings.antiAliasing = 4;
        Application.targetFrameRate = 60;
        SetGuideState("welcome");
    }

    private void Update()
    {
        groupElapsed += Time.deltaTime;
        mouthElapsed += Time.deltaTime;
        blinkElapsed += Time.deltaTime;
        idleClosedEyeElapsed += Time.deltaTime;
        UpdateAutoSwitch();
    }

    private void LateUpdate()
    {
        UpdateExpressions();
        UpdateBlush();
    }

    public void SetGuideState(string state)
    {
        if (string.IsNullOrWhiteSpace(state)) state = "idle";
        state = state.Trim().ToLowerInvariant();
        if (state != "welcome" && state != "thinking" && state != "speaking" && state != "fallback")
        {
            state = "idle";
        }

        if (requestedGroup == state && state != "welcome" && !string.IsNullOrEmpty(currentState)) return;
        requestedGroup = state;
        groupElapsed = 0f;
        if (state == "idle")
        {
            ResetIdleClosedEyeTimer(2.2f, 4.8f);
            ClearTransientWelcomeCue();
        }

        if (state == "welcome")
        {
            PlayState(welcomeState, "02_welcome", true);
        }
        else if (state == "thinking")
        {
            PlayState(NextState(thinkingStates, ref thinkingCursor, fallbackState), "02_think_confirm", false);
        }
        else if (state == "speaking")
        {
            PlayState(NextState(speakingStates, ref speakingCursor, "talk_basic_14"), "03_talk_explain", false);
        }
        else if (state == "fallback")
        {
            PlayState(fallbackState, "02_think_confirm", false);
        }
        else
        {
            PlayState(NextState(idleStates, ref idleCursor, "idle_neutral_04"), "01_idle", false);
        }
    }

    public void SetSpeechText(string text)
    {
        mouthElapsed = 0f;
    }

    public void SetEmotionCue(string cue)
    {
        emotionCue = NormalizeCue(cue);
    }

    public void SetExpressionCue(string cue)
    {
        SetEmotionCue(cue);
    }

    private void UpdateAutoSwitch()
    {
        if (requestedGroup == "welcome" && groupElapsed >= Mathf.Max(0.4f, CurrentClipSeconds(welcomeSeconds) - welcomeExitLeadSeconds))
        {
            SetGuideState("idle");
            return;
        }

        if (requestedGroup == "idle" && groupElapsed >= SwitchSecondsForCurrent(idleSwitchSeconds, 2.4f))
        {
            PlayState(NextState(idleStates, ref idleCursor, "idle_neutral_04"), "01_idle", false);
            return;
        }

        if (requestedGroup == "thinking" && groupElapsed >= SwitchSecondsForCurrent(thinkingSwitchSeconds, 1.5f))
        {
            PlayState(NextState(thinkingStates, ref thinkingCursor, fallbackState), "02_think_confirm", false);
            return;
        }

        if (requestedGroup == "speaking" && groupElapsed >= SwitchSecondsForCurrent(speakingSwitchSeconds, 2.0f))
        {
            PlayState(NextState(speakingStates, ref speakingCursor, "talk_basic_14"), "03_talk_explain", false);
        }
    }

    private void PlayState(string stateName, string category, bool replay)
    {
        if (animator == null || string.IsNullOrEmpty(stateName)) return;
        if (!replay && currentState == stateName) return;
        var hadState = !string.IsNullOrEmpty(currentState);
        currentState = stateName;
        groupElapsed = 0f;
        UpdateCurrentClipInfo(stateName);
        currentPlaybackSpeed = PlaybackSpeedForCategory(category);
        animator.speed = currentPlaybackSpeed;

        var transitionSeconds = TransitionSecondsForCategory(category);
        if (replay || !hadState || transitionSeconds <= 0.03f)
        {
            animator.Play(stateName, 0, 0f);
            animator.Update(0f);
        }
        else
        {
            animator.CrossFadeInFixedTime(stateName, transitionSeconds, 0, 0f);
        }

        if (armCorrection != null)
        {
            armCorrection.SetProfileForCategory(category);
        }
    }

    private void HideHeadAccessories()
    {
        foreach (var renderer in GetComponentsInChildren<Renderer>(true))
        {
            if (!ShouldHideHeadAccessory(renderer)) continue;
            renderer.enabled = false;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
        }
    }

    private static bool ShouldHideHeadAccessory(Renderer renderer)
    {
        var objectName = NormalizeAccessoryName(renderer.gameObject.name);
        if (IsHiddenHeadAccessoryName(objectName)) return true;

        var meshName = string.Empty;
        if (renderer is SkinnedMeshRenderer skinned && skinned.sharedMesh != null)
        {
            meshName = NormalizeAccessoryName(skinned.sharedMesh.name);
        }
        else
        {
            var meshFilter = renderer.GetComponent<MeshFilter>();
            if (meshFilter != null && meshFilter.sharedMesh != null)
            {
                meshName = NormalizeAccessoryName(meshFilter.sharedMesh.name);
            }
        }
        if (IsHiddenHeadAccessoryName(meshName)) return true;

        foreach (var material in renderer.sharedMaterials)
        {
            var materialName = NormalizeAccessoryName(material != null ? material.name : string.Empty);
            if (materialName == "ear" || materialName == "earguidewebgl" || materialName == "earhair" || materialName == "earhairguidewebgl")
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsHiddenHeadAccessoryName(string value)
    {
        return value == "ear"
            || value == "earbaked"
            || value.StartsWith("earguidewebgl", StringComparison.Ordinal)
            || value.StartsWith("earhair", StringComparison.Ordinal)
            || value == "hat"
            || value == "hatbaked"
            || value.StartsWith("hat", StringComparison.Ordinal);
    }

    private static string NormalizeAccessoryName(string value)
    {
        return (value ?? string.Empty)
            .Trim()
            .ToLowerInvariant()
            .Replace(" ", "")
            .Replace("_", "")
            .Replace("-", "")
            .Replace(".", "");
    }

    private float CurrentClipSeconds(float fallbackSeconds)
    {
        if (currentClipLength <= 0f) return fallbackSeconds;
        return Mathf.Max(0.1f, currentClipLength / Mathf.Max(0.01f, currentPlaybackSpeed));
    }

    private float SwitchSecondsForCurrent(float fallbackSeconds, float minimumSeconds)
    {
        var clipSeconds = CurrentClipSeconds(fallbackSeconds);
        if (currentClipLoops)
        {
            return Mathf.Max(minimumSeconds, clipSeconds);
        }
        return Mathf.Max(minimumSeconds, clipSeconds - 0.04f);
    }

    private void UpdateCurrentClipInfo(string stateName)
    {
        currentClipLength = 0f;
        currentClipLoops = false;
        if (clipStateNames == null || clipLengths == null) return;

        var count = Mathf.Min(clipStateNames.Length, clipLengths.Length);
        for (var i = 0; i < count; i++)
        {
            if (!string.Equals(clipStateNames[i], stateName, StringComparison.Ordinal)) continue;
            currentClipLength = Mathf.Max(0f, clipLengths[i]);
            currentClipLoops = clipLoops != null && i < clipLoops.Length && clipLoops[i];
            return;
        }
    }

    private float TransitionSecondsForCategory(string category)
    {
        var lower = (category ?? string.Empty).ToLowerInvariant();
        if (lower.Contains("welcome")) return welcomeTransitionSeconds;
        if (lower.Contains("think") || lower.Contains("confirm")) return thinkingTransitionSeconds;
        if (lower.Contains("talk") || lower.Contains("explain")) return speakingTransitionSeconds;
        if (lower.Contains("idle")) return idleTransitionSeconds;
        return Mathf.Max(0f, fallbackTransitionSeconds > 0f ? fallbackTransitionSeconds : crossFadeSeconds);
    }

    private float PlaybackSpeedForCategory(string category)
    {
        var lower = (category ?? string.Empty).ToLowerInvariant();
        var speed = 1f;
        if (lower.Contains("welcome")) speed = welcomePlaybackSpeed;
        else if (lower.Contains("think") || lower.Contains("confirm")) speed = thinkingPlaybackSpeed;
        else if (lower.Contains("talk") || lower.Contains("explain")) speed = speakingPlaybackSpeed;
        else if (lower.Contains("idle")) speed = idlePlaybackSpeed;
        return Mathf.Clamp(speed, 0.25f, 2.5f);
    }

    private static string NextState(string[] states, ref int cursor, string fallback)
    {
        if (states == null || states.Length == 0) return fallback;
        var state = states[Mathf.Abs(cursor) % states.Length];
        cursor = (cursor + 1) % states.Length;
        return string.IsNullOrEmpty(state) ? fallback : state;
    }

    private void CacheBlendTargets()
    {
        blinkTargets.Clear();
        lowerLidTargets.Clear();
        mouthATargets.Clear();
        mouthITargets.Clear();
        mouthUTargets.Clear();
        mouthETargets.Clear();
        mouthOTargets.Clear();
        neutralFaceTargets.Clear();
        closedSmileTargets.Clear();
        blushShapeTargets.Clear();
        tiredEyeTargets.Clear();
        sleepyFaceTargets.Clear();
        mouthSmallTargets.Clear();
        mouthRoundTargets.Clear();
        mouthLargeRoundTargets.Clear();
        mouthWideTargets.Clear();
        mouthWide2Targets.Clear();

        foreach (var renderer in GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            var mesh = renderer.sharedMesh;
            if (mesh == null) continue;
            for (var i = 0; i < mesh.blendShapeCount; i++)
            {
                var name = NormalizeBlendName(mesh.GetBlendShapeName(i));
                var target = new BlendTarget(renderer, i);

                if (name == "vrc_blink_left" || name == "vrc_blink_right") blinkTargets.Add(target);
                else if (name == "vrc_lowerrid_left" || name == "vrc_lowerrid_right") lowerLidTargets.Add(target);
                else if (name == "vrc_v_aa") mouthATargets.Add(target);
                else if (name == "vrc_v_ih") mouthITargets.Add(target);
                else if (name == "vrc_v_ou") mouthUTargets.Add(target);
                else if (name == "vrc_v_e") mouthETargets.Add(target);
                else if (name == "vrc_v_oh") mouthOTargets.Add(target);
                else if (name == "真面目") neutralFaceTargets.Add(target);
                else if (name == "笑い") closedSmileTargets.Add(target);
                else if (name == "頬染め2") blushShapeTargets.Add(target);
                else if (name == "じと目") tiredEyeTargets.Add(target);
                else if (name == "ねんね顔") sleepyFaceTargets.Add(target);
                else if (name == "え") mouthSmallTargets.Add(target);
                else if (name == "お") mouthRoundTargets.Add(target);
                else if (name == "おお") mouthLargeRoundTargets.Add(target);
                else if (name == "ワ") mouthWideTargets.Add(target);
                else if (name == "ワ２") mouthWide2Targets.Add(target);
            }
        }

        Debug.Log($"[Avatar151] Exact blend targets - blink:{blinkTargets.Count}, lowerrid:{lowerLidTargets.Count}, aa:{mouthATargets.Count}, ih:{mouthITargets.Count}, ou:{mouthUTargets.Count}, e:{mouthETargets.Count}, oh:{mouthOTargets.Count}, neutral:{neutralFaceTargets.Count}, smile04:{closedSmileTargets.Count}, blush35:{blushShapeTargets.Count}, tired36:{tiredEyeTargets.Count}, sleep37:{sleepyFaceTargets.Count}, mouth52-56:{SelectedMouthTargetCount()}");
    }

    private static string NormalizeBlendName(string name)
    {
        return (name ?? string.Empty)
            .Trim()
            .ToLowerInvariant()
            .Replace(" ", "")
            .Replace("-", "_")
            .Replace(".", "_")
            .Replace(":", "_")
            .Replace("/", "_");
    }

    private static string NormalizeCue(string cue)
    {
        return string.IsNullOrWhiteSpace(cue)
            ? "idle"
            : cue.Trim().ToLowerInvariant().Replace("-", "_").Replace(" ", "_");
    }

    private void ClearTransientWelcomeCue()
    {
        var cue = emotionCue ?? string.Empty;
        if (cue == "welcome" || cue == "wake")
        {
            emotionCue = "idle";
        }
    }

    private void UpdateExpressions()
    {
        var blink = CalculateBlinkWeight();
        var targetSpeaking = requestedGroup == "speaking" ? 1f : 0f;
        expressionBlend = Mathf.Lerp(expressionBlend, targetSpeaking, 1f - Mathf.Exp(-Time.deltaTime * 8.0f));

        var closedSmile = ClosedSmileTarget();
        var blushShape = BlushShapeTarget();
        var tiredEye = TiredEyeTarget();
        var sleepyFace = Mathf.Max(SleepyFaceTarget(), CalculateIdleClosedEyeWeight());
        var dominantEyeExpression = Mathf.Max(closedSmile, sleepyFace);
        var eyeExpressionStrength = Mathf.Clamp01(dominantEyeExpression / 100f);
        var hasSelectedMouthTargets = HasSelectedMouthTargets();
        var mouthEnvelope = expressionBlend * (0.66f + 0.34f * (Mathf.Sin(mouthElapsed * 10.0f) * 0.5f + 0.5f));
        var mouthExpressionStrength = requestedGroup == "speaking" && hasSelectedMouthTargets ? Mathf.Clamp01(mouthEnvelope) : 0f;
        var neutralFace = 100f;
        if (dominantEyeExpression > 1f)
        {
            neutralFace = Mathf.Lerp(100f, 0f, eyeExpressionStrength);
        }
        else if (tiredEye > 1f)
        {
            neutralFace = Mathf.Lerp(100f, 18f, Mathf.Clamp01(tiredEye / 100f));
        }
        if (mouthExpressionStrength > 0.01f)
        {
            neutralFace = Mathf.Min(neutralFace, Mathf.Lerp(92f, 20f, mouthExpressionStrength));
        }

        ApplyTargets(neutralFaceTargets, neutralFace, 12f);
        ApplyTargets(closedSmileTargets, closedSmile, 9f);
        ApplyTargets(blushShapeTargets, blushShape, 7f);
        ApplyTargets(tiredEyeTargets, tiredEye, 8f);
        ApplyTargets(sleepyFaceTargets, sleepyFace, 8f);

        ApplyTargets(blinkTargets, blink * 96f * (1f - eyeExpressionStrength), 14f);
        ApplyTargets(lowerLidTargets, Mathf.Max(blink * 28f * (1f - eyeExpressionStrength), tiredEye * 0.18f), 10f);

        var phase = Mathf.Repeat(mouthElapsed * 2.85f, 1f);

        if (hasSelectedMouthTargets)
        {
            ApplyTargets(mouthATargets, 0f, 16f);
            ApplyTargets(mouthITargets, 0f, 16f);
            ApplyTargets(mouthUTargets, 0f, 16f);
            ApplyTargets(mouthETargets, 0f, 16f);
            ApplyTargets(mouthOTargets, 0f, 16f);
            ApplySelectedMouthSequence(phase, mouthEnvelope);
        }
        else
        {
            var aa = VowelPulse(phase, 0.05f, 0.22f) * 100f * mouthEnvelope;
            var ih = VowelPulse(phase, 0.25f, 0.18f) * 68f * mouthEnvelope;
            var ou = VowelPulse(phase, 0.45f, 0.20f) * 78f * mouthEnvelope;
            var ee = VowelPulse(phase, 0.63f, 0.18f) * 62f * mouthEnvelope;
            var oh = VowelPulse(phase, 0.82f, 0.22f) * 92f * mouthEnvelope;

            ApplyTargets(mouthATargets, aa, 16f);
            ApplyTargets(mouthITargets, ih, 16f);
            ApplyTargets(mouthUTargets, ou, 16f);
            ApplyTargets(mouthETargets, ee, 16f);
            ApplyTargets(mouthOTargets, oh, 16f);
        }
    }

    private float ClosedSmileTarget()
    {
        var cue = emotionCue ?? string.Empty;
        var target = 0f;
        if (cue == "success") target = Mathf.Max(target, 100f);
        if (cue == "welcome" || cue == "wake" || requestedGroup == "welcome") target = Mathf.Max(target, 88f);
        if (cue == "smile" || cue == "closed_smile") target = Mathf.Max(target, 100f);
        return Mathf.Clamp(target, 0f, 100f);
    }

    private float BlushShapeTarget()
    {
        var cue = emotionCue ?? string.Empty;
        var target = 0f;
        if (cue == "blush") target = Mathf.Max(target, 100f);
        if (cue == "success") target = Mathf.Max(target, 92f);
        if (cue == "welcome" || cue == "wake" || requestedGroup == "welcome") target = Mathf.Max(target, 58f);
        if (cue == "idle" && requestedGroup == "idle") target = Mathf.Max(target, 48f);
        if (cue == "fallback" || requestedGroup == "fallback") target = Mathf.Max(target, 42f);
        if (cue == "thinking" || requestedGroup == "thinking") target = Mathf.Max(target, 20f);
        return Mathf.Clamp(target, 0f, 100f);
    }

    private float TiredEyeTarget()
    {
        var cue = emotionCue ?? string.Empty;
        var target = 0f;
        if (cue == "tired" || cue == "tired_eye") target = Mathf.Max(target, 100f);
        if (cue == "thinking" || requestedGroup == "thinking") target = Mathf.Max(target, 82f);
        if (cue == "fallback" || requestedGroup == "fallback") target = Mathf.Max(target, 68f);
        return Mathf.Clamp(target, 0f, 100f);
    }

    private float SleepyFaceTarget()
    {
        var cue = emotionCue ?? string.Empty;
        if (cue == "sleep" || cue == "sleepy" || cue == "closed_eye") return 100f;
        return 0f;
    }

    private float CalculateIdleClosedEyeWeight()
    {
        var cue = emotionCue ?? string.Empty;
        if (requestedGroup != "idle" || cue != "idle") return 0f;
        if (sleepyFaceTargets.Count <= 0) return 0f;
        if (idleClosedEyeElapsed < nextIdleClosedEyeIn) return 0f;

        var t = idleClosedEyeElapsed - nextIdleClosedEyeIn;
        float weight;
        if (t < 0.14f)
        {
            weight = Smooth01(t / 0.14f);
        }
        else if (t < 0.38f)
        {
            weight = 1f;
        }
        else
        {
            weight = Mathf.Max(0f, 1f - Smooth01((t - 0.38f) / 0.28f));
        }

        if (t > 0.70f)
        {
            ResetIdleClosedEyeTimer(5.8f, 10.5f);
        }
        return Mathf.Clamp01(weight) * 100f;
    }

    private void ResetIdleClosedEyeTimer(float minSeconds, float maxSeconds)
    {
        idleClosedEyeElapsed = 0f;
        nextIdleClosedEyeIn = UnityEngine.Random.Range(minSeconds, maxSeconds);
    }

    private bool HasSelectedMouthTargets()
    {
        return SelectedMouthTargetCount() > 0;
    }

    private int SelectedMouthTargetCount()
    {
        return mouthSmallTargets.Count
            + mouthRoundTargets.Count
            + mouthLargeRoundTargets.Count
            + mouthWideTargets.Count
            + mouthWide2Targets.Count;
    }

    private void ApplySelectedMouthSequence(float phase, float mouthEnvelope)
    {
        var small = VowelPulse(phase, 0.05f, 0.18f) * 62f * mouthEnvelope;
        var round = VowelPulse(phase, 0.24f, 0.18f) * 78f * mouthEnvelope;
        var largeRound = VowelPulse(phase, 0.44f, 0.20f) * 96f * mouthEnvelope;
        var wide = VowelPulse(phase, 0.64f, 0.18f) * 100f * mouthEnvelope;
        var wide2 = VowelPulse(phase, 0.83f, 0.20f) * 88f * mouthEnvelope;

        ApplyTargets(mouthSmallTargets, small, 18f);
        ApplyTargets(mouthRoundTargets, round, 18f);
        ApplyTargets(mouthLargeRoundTargets, largeRound, 18f);
        ApplyTargets(mouthWideTargets, wide, 18f);
        ApplyTargets(mouthWide2Targets, wide2, 18f);
    }

    private float CalculateBlinkWeight()
    {
        if (blinkElapsed < nextBlinkIn) return 0f;
        var t = blinkElapsed - nextBlinkIn;
        float weight;
        if (t < 0.095f)
        {
            weight = Smooth01(t / 0.095f);
        }
        else if (t < 0.150f)
        {
            weight = 1f;
        }
        else
        {
            weight = Mathf.Max(0f, 1f - Smooth01((t - 0.150f) / 0.200f));
        }

        if (t > 0.36f)
        {
            blinkElapsed = 0f;
            nextBlinkIn = UnityEngine.Random.Range(2.0f, 4.0f);
        }
        return Mathf.Clamp01(weight);
    }

    private void UpdateBlush()
    {
        if (blushOverlay == null) return;
        var target = BlushTargetAlpha();
        var speed = target > blushAlpha ? 5.0f : 3.2f;
        blushAlpha = Mathf.Lerp(blushAlpha, target, 1f - Mathf.Exp(-Time.deltaTime * speed));
        blushOverlay.SetAlpha(blushAlpha);
    }

    private float BlushTargetAlpha()
    {
        var cue = emotionCue ?? string.Empty;
        var target = 0f;
        if (cue == "blush") target = Mathf.Max(target, 0.34f);
        else if (cue == "success") target = Mathf.Max(target, 0.24f);
        else if (cue == "welcome" || cue == "wake") target = Mathf.Max(target, 0.18f);
        else if (cue == "idle" && requestedGroup == "idle") target = Mathf.Max(target, 0.14f);
        else if (cue == "fallback") target = Mathf.Max(target, 0.16f);
        else if (cue == "thinking") target = Mathf.Max(target, 0.10f);
        else if (cue == "speaking") target = Mathf.Max(target, 0.08f);

        if (requestedGroup == "welcome") target = Mathf.Max(target, 0.16f);
        else if (requestedGroup == "fallback") target = Mathf.Max(target, 0.14f);
        else if (requestedGroup == "thinking") target = Mathf.Max(target, 0.08f);
        else if (requestedGroup == "speaking") target = Mathf.Max(target, 0.06f);

        return Mathf.Clamp01(target);
    }

    private static float Smooth01(float value)
    {
        value = Mathf.Clamp01(value);
        return value * value * (3f - 2f * value);
    }

    private static float VowelPulse(float phase, float center, float width)
    {
        var distance = Mathf.Abs(Mathf.DeltaAngle(phase * 360f, center * 360f)) / 360f;
        return Mathf.Clamp01(1f - distance / Mathf.Max(0.001f, width));
    }

    private static void ApplyTargets(List<BlendTarget> targets, float value, float speed)
    {
        if (targets == null || targets.Count == 0) return;
        value = Mathf.Clamp(value, 0f, 100f);
        var blend = 1f - Mathf.Exp(-Time.deltaTime * speed);
        foreach (var target in targets)
        {
            if (target.Renderer == null) continue;
            var current = target.Renderer.GetBlendShapeWeight(target.Index);
            target.Renderer.SetBlendShapeWeight(target.Index, Mathf.Lerp(current, value, blend));
        }
    }

    private readonly struct BlendTarget
    {
        public readonly SkinnedMeshRenderer Renderer;
        public readonly int Index;

        public BlendTarget(SkinnedMeshRenderer renderer, int index)
        {
            Renderer = renderer;
            Index = index;
        }
    }
}

public class Avatar151BlushOverlay : MonoBehaviour
{
    public Animator animator;
    public Camera targetCamera;
    public Color blushColor = new Color(1f, 0.22f, 0.34f, 1f);
    public float horizontalOffsetFactor = 0.036f;
    public float verticalOffsetFactor = 0.052f;
    public float forwardOffsetFactor = 0.058f;
    public float widthFactor = 0.060f;
    public float heightFactor = 0.027f;

    private Transform head;
    private Mesh blushMesh;
    private Material blushMaterial;
    private Texture2D blushTexture;
    private readonly Transform[] patches = new Transform[2];
    private readonly MeshRenderer[] patchRenderers = new MeshRenderer[2];
    private float modelHeight = 1.55f;
    private float alpha;
    private bool initialized;

    public void SetAlpha(float value)
    {
        alpha = Mathf.Clamp01(value);
        EnsureCreated();
        ApplyAlpha();
    }

    private void LateUpdate()
    {
        if (alpha <= 0.002f) return;
        EnsureCreated();
        PositionPatches();
    }

    private void EnsureCreated()
    {
        if (initialized) return;
        if (animator == null) animator = GetComponentInChildren<Animator>();
        if (animator == null) return;

        head = animator.GetBoneTransform(HumanBodyBones.Head);
        if (head == null) return;

        targetCamera = targetCamera != null ? targetCamera : Camera.main;
        modelHeight = Mathf.Max(0.1f, CalculateRendererBounds().size.y);
        blushMaterial = CreateBlushMaterial();
        patches[0] = CreatePatch("Avatar151_Left_Blush", 0);
        patches[1] = CreatePatch("Avatar151_Right_Blush", 1);
        initialized = true;
        ApplyAlpha();
        PositionPatches();
    }

    private Transform CreatePatch(string patchName, int index)
    {
        var patch = new GameObject(patchName);
        patch.name = patchName;
        patch.layer = gameObject.layer;
        patch.transform.SetParent(transform, false);

        if (blushMesh == null) blushMesh = CreateQuadMesh();
        var meshFilter = patch.AddComponent<MeshFilter>();
        meshFilter.sharedMesh = blushMesh;

        var renderer = patch.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = blushMaterial;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = LightProbeUsage.Off;
        renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        renderer.allowOcclusionWhenDynamic = false;
        renderer.sortingOrder = 40;
        patchRenderers[index] = renderer;
        return patch.transform;
    }

    private static Mesh CreateQuadMesh()
    {
        var mesh = new Mesh { name = "Avatar151_BlushQuad" };
        mesh.vertices = new[]
        {
            new Vector3(-0.5f, -0.5f, 0f),
            new Vector3(0.5f, -0.5f, 0f),
            new Vector3(-0.5f, 0.5f, 0f),
            new Vector3(0.5f, 0.5f, 0f),
        };
        mesh.uv = new[]
        {
            new Vector2(0f, 0f),
            new Vector2(1f, 0f),
            new Vector2(0f, 1f),
            new Vector2(1f, 1f),
        };
        mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
        mesh.RecalculateBounds();
        return mesh;
    }

    private Material CreateBlushMaterial()
    {
        blushTexture = CreateBlushTexture();
        var shader = Shader.Find("Unlit/Transparent") ?? Shader.Find("Sprites/Default") ?? Shader.Find("Standard");
        var material = new Material(shader)
        {
            name = "Avatar151_BlushOverlay",
            renderQueue = 3100
        };

        if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", blushTexture);
        if (material.HasProperty("_Color")) material.SetColor("_Color", new Color(1f, 1f, 1f, 0f));
        ConfigureTransparentMaterial(material);
        return material;
    }

    private Texture2D CreateBlushTexture()
    {
        const int size = 64;
        var texture = new Texture2D(size, size, TextureFormat.RGBA32, false, true)
        {
            name = "Avatar151_BlushTexture",
            wrapMode = TextureWrapMode.Clamp,
            filterMode = FilterMode.Bilinear
        };

        var pixels = new Color[size * size];
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size; x++)
            {
                var nx = ((x + 0.5f) / size) * 2f - 1f;
                var ny = ((y + 0.5f) / size) * 2f - 1f;
                var distance = Mathf.Sqrt(nx * nx + ny * ny * 1.85f);
                var radial = Mathf.Clamp01(1f - distance);
                var pixelAlpha = Smooth01(radial) * 0.92f;
                pixels[y * size + x] = new Color(blushColor.r, blushColor.g, blushColor.b, pixelAlpha);
            }
        }

        texture.SetPixels(pixels);
        texture.Apply(false, true);
        return texture;
    }

    private static void ConfigureTransparentMaterial(Material material)
    {
        if (material.HasProperty("_Mode")) material.SetFloat("_Mode", 3f);
        if (material.HasProperty("_SrcBlend")) material.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
        if (material.HasProperty("_DstBlend")) material.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
        if (material.HasProperty("_ZWrite")) material.SetInt("_ZWrite", 0);
        if (material.HasProperty("_Cull")) material.SetInt("_Cull", (int)CullMode.Off);
        material.DisableKeyword("_ALPHATEST_ON");
        material.EnableKeyword("_ALPHABLEND_ON");
        material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
    }

    private void ApplyAlpha()
    {
        if (blushMaterial != null && blushMaterial.HasProperty("_Color"))
        {
            blushMaterial.SetColor("_Color", new Color(1f, 1f, 1f, alpha));
        }

        var visible = alpha > 0.006f;
        for (var i = 0; i < patchRenderers.Length; i++)
        {
            if (patchRenderers[i] != null) patchRenderers[i].enabled = visible;
        }
    }

    private void PositionPatches()
    {
        if (!initialized || head == null || patches[0] == null || patches[1] == null) return;
        var camera = targetCamera != null ? targetCamera : Camera.main;
        var headPosition = head.position;
        var toCamera = camera != null ? camera.transform.position - headPosition : -transform.forward;
        if (toCamera.sqrMagnitude < 0.0001f) toCamera = -transform.forward;
        toCamera.Normalize();

        var right = camera != null ? camera.transform.right : transform.right;
        var up = camera != null ? camera.transform.up : Vector3.up;
        var center = headPosition
            + up * (modelHeight * verticalOffsetFactor)
            + toCamera * (modelHeight * forwardOffsetFactor);
        var horizontalOffset = right * (modelHeight * horizontalOffsetFactor);
        var scale = new Vector3(modelHeight * widthFactor, modelHeight * heightFactor, 1f);
        var rotation = Quaternion.LookRotation(toCamera, up);

        patches[0].position = center - horizontalOffset;
        patches[1].position = center + horizontalOffset;
        patches[0].rotation = rotation;
        patches[1].rotation = rotation;
        patches[0].localScale = scale;
        patches[1].localScale = scale;
    }

    private Bounds CalculateRendererBounds()
    {
        var renderers = GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return new Bounds(transform.position + Vector3.up, Vector3.one * 1.55f);
        var bounds = renderers[0].bounds;
        for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
        return bounds;
    }

    private static float Smooth01(float value)
    {
        value = Mathf.Clamp01(value);
        return value * value * (3f - 2f * value);
    }
}

public class Avatar151TransparentCameraClear : MonoBehaviour
{
    public static readonly Color ChromaColor = new Color(0f, 1f, 0f, 1f);

    private void OnPreRender()
    {
        GL.Clear(true, true, ChromaColor);
    }
}


