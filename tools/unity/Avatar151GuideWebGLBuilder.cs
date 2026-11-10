using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class Avatar151GuideWebGLBuilder
{
    private const string ModelAsset = "Assets/Avatar151Review/Model/Uketsukejou_v121.fbx";
    private const string MotionsRoot = "Assets/Avatar151Review";
    private const string ReviewRoot = "Assets/Avatar151Review/Review";
    private const string ScenePath = "Assets/Avatar151Review/Review/Avatar151GuideWebGL.unity";
    private const string ControllerPath = "Assets/Avatar151Review/Review/Avatar151GuideWebGL.controller";

    private static readonly GuideClip[] Clips =
    {
        new GuideClip("welcome_wave_08", "welcome", false, "guide_welcome_waving_01.fbx"),
        new GuideClip("idle_neutral_04", "idle", true, "guide_idle_neutral_01.fbx"),
        new GuideClip("idle_or_think_19", "idle", true, "19_"),
        new GuideClip("think_looking_14", "thinking", true, "think_looking_14.fbx"),
        new GuideClip("talk_basic_14", "speaking", true, "guide_talk_basic_02.fbx"),
        new GuideClip("talk_basic_15", "speaking", true, "guide_talk_basic_03.fbx"),
        new GuideClip("talk_confirm_32", "speaking", true, "32_"),
        new GuideClip("talk_waist_48", "speaking", true, "48_"),
    };

    private static readonly MaterialTextureRule[] MaterialTextureRules =
    {
        new MaterialTextureRule(new[] { "lefteye", "righteye", "eye", "facial", "expression", "mouth" }, "Skin.psd", Color.white, true, true),
        new MaterialTextureRule(new[] { "hat", "cap", "hairpin" }, "hat.psd", new Color(0.15f, 0.12f, 0.13f, 1f)),
        new MaterialTextureRule(new[] { "skin", "face", "body", "hand", "arm", "leg", "head", "ear" }, "Skin.psd", new Color(0.94f, 0.82f, 0.76f, 1f), true),
        new MaterialTextureRule(new[] { "hair" }, "Hair.psd", new Color(0.46f, 0.34f, 0.30f, 1f)),
        new MaterialTextureRule(new[] { "wear", "coat", "jacket", "outer", "uniform", "cloth", "cardigan" }, "Wear.psd", new Color(0.10f, 0.12f, 0.15f, 1f)),
        new MaterialTextureRule(new[] { "shirt", "shirts", "blouse", "white" }, "shirts.psd", new Color(0.88f, 0.84f, 0.76f, 1f)),
        new MaterialTextureRule(new[] { "hotpants", "pants", "short" }, "hotpants.psd", new Color(0.08f, 0.08f, 0.09f, 1f)),
        new MaterialTextureRule(new[] { "tie" }, "tie.psd", new Color(0.85f, 0.12f, 0.18f, 1f)),
        new MaterialTextureRule(new[] { "ribbon" }, "ribbon(Chest).psd", new Color(0.85f, 0.10f, 0.14f, 1f)),
        new MaterialTextureRule(new[] { "sandal", "shoe", "foot" }, "Sandals.psd", new Color(0.18f, 0.15f, 0.12f, 1f)),
        new MaterialTextureRule(new[] { "holster" }, "LegHolster.psd", new Color(0.05f, 0.05f, 0.06f, 1f)),
    };
    [MenuItem("Avatar151 Guide/Build WebGL Scene")]
    public static void BuildGuideScene()
    {
        Directory.CreateDirectory(ReviewRoot);
        ConfigureModel();
        var resolvedClips = ResolveAndConfigureClips();
        var avatar = FindHumanAvatar(ModelAsset);
        if (avatar == null) throw new InvalidOperationException("151 model did not produce a Unity Humanoid avatar.");
        var controller = CreateController(resolvedClips);
        CreateScene(avatar, controller, resolvedClips);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[Avatar151GuideWebGLBuilder] Scene ready: " + ScenePath);
    }

    [MenuItem("Avatar151 Guide/Build WebGL Player")]
    public static void BuildGuideWebGLPlayer()
    {
        BuildGuideScene();

        var output = Environment.GetEnvironmentVariable("AVATAR151_WEBGL_OUTPUT");
        if (string.IsNullOrWhiteSpace(output))
        {
            output = Path.GetFullPath(
                Path.Combine(Application.dataPath, "..", "Builds", "avatar151-guide")
            );
        }
        Directory.CreateDirectory(output);

        EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
        PlayerSettings.productName = "avatar151-guide";
        PlayerSettings.companyName = "A5";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.dataCaching = false;
                PlayerSettings.WebGL.memorySize = 256;
        PlayerSettings.SplashScreen.show = false;
        PlayerSettings.SplashScreen.showUnityLogo = false;

        var options = new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = output,
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        };

        var report = BuildPipeline.BuildPlayer(options);
        Debug.Log("[Avatar151GuideWebGLBuilder] Build result: " + report.summary.result + " -> " + output);
    }

    private static void ConfigureModel()
    {
        var importer = AssetImporter.GetAtPath(ModelAsset) as ModelImporter;
        if (importer == null) throw new FileNotFoundException("151 FBX not found in Unity project", ModelAsset);
        importer.animationType = ModelImporterAnimationType.Human;
        importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
        importer.importAnimation = false;
        importer.importBlendShapes = true;
        importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
        importer.SaveAndReimport();
    }

    private static List<ResolvedClip> ResolveAndConfigureClips()
    {
        var allFbx = Directory.GetFiles(Application.dataPath + "/Avatar151Review", "*.fbx", SearchOption.AllDirectories)
            .Select(ToAssetPath)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var result = new List<ResolvedClip>();
        foreach (var clip in Clips)
        {
            var assetPath = allFbx.FirstOrDefault(path =>
                Path.GetFileName(path).Equals(clip.FileOrPrefix, StringComparison.OrdinalIgnoreCase)
                || Path.GetFileName(path).StartsWith(clip.FileOrPrefix, StringComparison.OrdinalIgnoreCase));
            if (string.IsNullOrEmpty(assetPath))
            {
                throw new FileNotFoundException("Motion asset not found for " + clip.StateName + " using " + clip.FileOrPrefix);
            }

            ConfigureMotionImport(assetPath, clip.Loop);
            var animationClip = FindPrimaryClip(assetPath);
            if (animationClip == null) throw new InvalidOperationException("No animation clip found in " + assetPath);
            result.Add(new ResolvedClip(clip, assetPath, animationClip));
        }

        return result;
    }

    private static void ConfigureMotionImport(string assetPath, bool loop)
    {
        var importer = AssetImporter.GetAtPath(assetPath) as ModelImporter;
        if (importer == null) return;
        importer.animationType = ModelImporterAnimationType.Human;
        importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
        importer.sourceAvatar = null;
        importer.importAnimation = true;
        importer.materialImportMode = ModelImporterMaterialImportMode.None;

        var clips = importer.defaultClipAnimations;
        if (clips != null && clips.Length > 0)
        {
            for (var i = 0; i < clips.Length; i++)
            {
                clips[i].loopTime = loop;
                clips[i].loopPose = loop;
                clips[i].lockRootRotation = true;
                clips[i].lockRootHeightY = true;
                clips[i].lockRootPositionXZ = true;
                clips[i].keepOriginalOrientation = false;
                clips[i].keepOriginalPositionY = false;
                clips[i].keepOriginalPositionXZ = false;
            }
            importer.clipAnimations = clips;
        }

        importer.SaveAndReimport();
    }

    private static AnimatorController CreateController(List<ResolvedClip> clips)
    {
        if (File.Exists(ControllerPath)) AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
        var machine = controller.layers[0].stateMachine;
        machine.states = Array.Empty<ChildAnimatorState>();
        foreach (var item in clips)
        {
            var state = machine.AddState(item.Spec.StateName);
            state.motion = item.Clip;
            state.writeDefaultValues = true;
            if (machine.defaultState == null) machine.defaultState = state;
        }
        return controller;
    }

    private static void CreateScene(Avatar avatar, RuntimeAnimatorController controller, List<ResolvedClip> clips)
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        scene.name = "Avatar151GuideWebGL";

        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ModelAsset);
        var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
        if (instance == null) throw new InvalidOperationException("Could not instantiate 151 model.");

        instance.name = "Avatar151GuideModel";
        instance.transform.position = Vector3.zero;
        instance.transform.rotation = Quaternion.identity;
        instance.transform.localScale = Vector3.one;

        AssignPreviewMaterials(instance);
        HideHeadAccessories(instance);
        NormalizeModelToGround(instance);

        var animator = instance.GetComponent<Animator>() ?? instance.AddComponent<Animator>();
        animator.avatar = avatar;
        animator.runtimeAnimatorController = controller;
        animator.applyRootMotion = false;
        animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;

        var armCorrection = instance.GetComponent<ArmOutwardCorrection>() ?? instance.AddComponent<ArmOutwardCorrection>();
        armCorrection.animator = animator;
        armCorrection.correctionEnabled = true;
        armCorrection.globalStrength = 0.78f;

        var bridge = instance.GetComponent<Avatar151GuideWebGLController>() ?? instance.AddComponent<Avatar151GuideWebGLController>();
        bridge.animator = animator;
        bridge.armCorrection = armCorrection;
        bridge.welcomeState = "welcome_wave_08";
        bridge.idleStates = clips.Where(item => item.Spec.Group == "idle").Select(item => item.Spec.StateName).ToArray();
        bridge.thinkingStates = clips.Where(item => item.Spec.Group == "thinking").Select(item => item.Spec.StateName).ToArray();
        bridge.speakingStates = clips.Where(item => item.Spec.Group == "speaking").Select(item => item.Spec.StateName).ToArray();
        bridge.fallbackState = "think_looking_14";
        bridge.clipStateNames = clips.Select(item => item.Spec.StateName).ToArray();
        bridge.clipLengths = clips.Select(item => item.Clip.length).ToArray();
        bridge.clipLoops = clips.Select(item => item.Spec.Loop).ToArray();

        instance.name = "Avatar151Bridge";

        var bounds = CalculateRendererBounds(instance);
        var center = bounds.center;
        var height = Mathf.Max(0.01f, bounds.size.y);

        // The guide page needs a bust-style framing: head to around thigh.
        // Use the model bounds directly instead of CSS scaling so the WebGL frame contains the body.
        var visibleTop = bounds.max.y + height * 0.04f;
        var visibleBottom = bounds.min.y - height * 0.05f;
        var focusY = (visibleTop + visibleBottom) * 0.5f;
        const float guideAspect = 0.68f;

        var cameraObject = new GameObject("Guide_Camera");
        var camera = cameraObject.AddComponent<Camera>();
        camera.transform.position = new Vector3(center.x, focusY, center.z + 4.35f);
        camera.transform.LookAt(new Vector3(center.x, focusY, center.z));
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Avatar151TransparentCameraClear.ChromaColor;
        camera.orthographic = true;
        camera.aspect = guideAspect;
        var verticalSize = Mathf.Max(0.68f, (visibleTop - visibleBottom) * 0.58f);
        var horizontalSize = Mathf.Max(0.34f, bounds.extents.x * 1.10f / guideAspect);
        camera.orthographicSize = Mathf.Max(verticalSize, horizontalSize);
        camera.allowHDR = false;
        cameraObject.AddComponent<Avatar151TransparentCameraClear>();
        cameraObject.tag = "MainCamera";

        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.74f, 0.70f, 0.66f, 1f);

        AddLight("Key_Light", 0.36f, new Vector3(38f, -25f, 0f), new Color(1f, 0.90f, 0.82f));
        AddLight("Fill_Light", 0.18f, new Vector3(16f, 145f, 0f), new Color(0.82f, 0.90f, 1f));
        AddLight("Rim_Light", 0.10f, new Vector3(24f, 214f, 0f), new Color(1f, 0.96f, 0.90f));

        EditorSceneManager.SaveScene(scene, ScenePath);
    }

    private static void HideHeadAccessories(GameObject instance)
    {
        var hidden = new List<string>();
        foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true))
        {
            if (!ShouldHideHeadAccessory(renderer)) continue;
            renderer.enabled = false;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            hidden.Add(renderer.gameObject.name);
        }

        Debug.Log("[Avatar151GuideWebGLBuilder] Hidden head accessories: " + (hidden.Count > 0 ? string.Join(", ", hidden) : "none"));
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

    private static void AddLight(string name, float intensity, Vector3 rotation, Color color)
    {
        var lightObject = new GameObject(name);
        var light = lightObject.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = intensity;
        light.color = color;
        light.shadows = LightShadows.None;
        light.shadowStrength = 0f;
        light.transform.rotation = Quaternion.Euler(rotation);
    }

    private static void AssignPreviewMaterials(GameObject instance)
    {
        foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true))
        {
            var materials = renderer.sharedMaterials;
            for (var index = 0; index < materials.Length; index++)
            {
                var material = materials[index];
                if (material == null) continue;

                var lookupKey = NormalizeMaterialKey(material.name);
                var rule = FindTextureRule(lookupKey);
                var texture = rule.TextureName == null ? null : LoadTexture(rule.TextureName);
                var shader = Shader.Find(rule.Transparent ? "Unlit/Transparent" : rule.UseUnlit ? (texture != null ? "Unlit/Texture" : "Unlit/Color") : "Standard")
                    ?? Shader.Find("Standard")
                    ?? material.shader;
                var tintColor = texture != null && !rule.UseUnlit ? Color.white : rule.FallbackColor;
                var replacement = new Material(shader)
                {
                    name = material.name + "_GuideWebGL",
                    color = tintColor
                };

                if (replacement.HasProperty("_MainTex") && texture != null)
                {
                    replacement.SetTexture("_MainTex", texture);
                }

                if (replacement.HasProperty("_Color"))
                {
                    replacement.color = tintColor;
                }

                if (replacement.HasProperty("_Glossiness")) replacement.SetFloat("_Glossiness", 0.0f);
                if (replacement.HasProperty("_Metallic")) replacement.SetFloat("_Metallic", 0f);
                if (replacement.HasProperty("_Smoothness")) replacement.SetFloat("_Smoothness", 0.0f);
                if (replacement.HasProperty("_SpecularHighlights")) replacement.SetFloat("_SpecularHighlights", 0f);
                if (replacement.HasProperty("_EnvironmentReflections")) replacement.SetFloat("_EnvironmentReflections", 0f);
                if (rule.Transparent)
                {
                    replacement.renderQueue = 3000;
                    if (replacement.HasProperty("_ZWrite")) replacement.SetFloat("_ZWrite", 0f);
                }
                replacement.DisableKeyword("_SPECGLOSSMAP");
                replacement.EnableKeyword("_SPECULARHIGHLIGHTS_OFF");
                replacement.EnableKeyword("_GLOSSYREFLECTIONS_OFF");
                materials[index] = replacement;
            }
            renderer.sharedMaterials = materials;
        }
    }

    private static MaterialTextureRule FindTextureRule(string lookupKey)
    {
        foreach (var rule in MaterialTextureRules)
        {
            if (rule.Keywords.Any(keyword => lookupKey.Contains(keyword))) return rule;
        }
        return new MaterialTextureRule(Array.Empty<string>(), null, new Color(0.72f, 0.70f, 0.66f, 1f));
    }

    private static Texture2D LoadTexture(string textureName)
    {
        if (string.IsNullOrEmpty(textureName)) return null;
        var texturePath = "Assets/Avatar151Review/Model/PSD/" + textureName;
        return AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
    }

    private static string NormalizeMaterialKey(string materialName)
    {
        return (materialName ?? "")
            .ToLowerInvariant()
            .Replace("(instance)", "")
            .Replace("_guidewebgl", "")
            .Replace("_runtimetexture", "")
            .Replace("_expressionlab", "")
            .Trim();
    }

    private static void NormalizeModelToGround(GameObject instance)
    {
        var bounds = CalculateRendererBounds(instance);
        instance.transform.position += new Vector3(-bounds.center.x, -bounds.min.y, -bounds.center.z);
    }

    private static Bounds CalculateRendererBounds(GameObject instance)
    {
        var renderers = instance.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return new Bounds(Vector3.up, Vector3.one * 2f);
        var bounds = renderers[0].bounds;
        for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
        return bounds;
    }

    private static Avatar FindHumanAvatar(string assetPath)
    {
        return AssetDatabase.LoadAllAssetsAtPath(assetPath).OfType<Avatar>().FirstOrDefault(avatar => avatar != null && avatar.isHuman);
    }

    private static AnimationClip FindPrimaryClip(string assetPath)
    {
        return AssetDatabase.LoadAllAssetsAtPath(assetPath)
            .OfType<AnimationClip>()
            .Where(clip => clip != null && !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(clip => clip.length)
            .FirstOrDefault();
    }

    private static string ToAssetPath(string fullPath)
    {
        var normalized = fullPath.Replace('\\', '/');
        var assetsIndex = normalized.IndexOf("/Assets/", StringComparison.OrdinalIgnoreCase);
        return assetsIndex >= 0 ? normalized.Substring(assetsIndex + 1) : normalized;
    }

    private readonly struct MaterialTextureRule
    {
        public readonly string[] Keywords;
        public readonly string TextureName;
        public readonly Color FallbackColor;
        public readonly bool UseUnlit;
        public readonly bool Transparent;

        public MaterialTextureRule(string[] keywords, string textureName, Color fallbackColor, bool useUnlit = false, bool transparent = false)
        {
            Keywords = keywords;
            TextureName = textureName;
            FallbackColor = fallbackColor;
            UseUnlit = useUnlit;
            Transparent = transparent;
        }
    }
    private readonly struct GuideClip
    {
        public readonly string StateName;
        public readonly string Group;
        public readonly bool Loop;
        public readonly string FileOrPrefix;

        public GuideClip(string stateName, string group, bool loop, string fileOrPrefix)
        {
            StateName = stateName;
            Group = group;
            Loop = loop;
            FileOrPrefix = fileOrPrefix;
        }
    }

    private readonly struct ResolvedClip
    {
        public readonly GuideClip Spec;
        public readonly string AssetPath;
        public readonly AnimationClip Clip;

        public ResolvedClip(GuideClip spec, string assetPath, AnimationClip clip)
        {
            Spec = spec;
            AssetPath = assetPath;
            Clip = clip;
        }
    }
}






