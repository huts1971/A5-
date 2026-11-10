using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

public static class Avatar151FrontendMotionBaker
{
    private const string ModelAsset = "Assets/Avatar151Review/Model/Uketsukejou_v121.fbx";
    private const string ControllerPath = "Assets/Avatar151Review/Review/Avatar151FrontendBake.controller";
    private const int BakeFps = 18;

    private static readonly BoneSpec[] Bones =
    {
        new BoneSpec("hips", HumanBodyBones.Hips),
        new BoneSpec("spine", HumanBodyBones.Spine),
        new BoneSpec("chest", HumanBodyBones.Chest),
        new BoneSpec("upperChest", HumanBodyBones.UpperChest),
        new BoneSpec("neck", HumanBodyBones.Neck),
        new BoneSpec("head", HumanBodyBones.Head),
        new BoneSpec("leftShoulder", HumanBodyBones.LeftShoulder),
        new BoneSpec("leftUpperArm", HumanBodyBones.LeftUpperArm),
        new BoneSpec("leftLowerArm", HumanBodyBones.LeftLowerArm),
        new BoneSpec("leftHand", HumanBodyBones.LeftHand),
        new BoneSpec("rightShoulder", HumanBodyBones.RightShoulder),
        new BoneSpec("rightUpperArm", HumanBodyBones.RightUpperArm),
        new BoneSpec("rightLowerArm", HumanBodyBones.RightLowerArm),
        new BoneSpec("rightHand", HumanBodyBones.RightHand),
        new BoneSpec("leftUpperLeg", HumanBodyBones.LeftUpperLeg),
        new BoneSpec("leftLowerLeg", HumanBodyBones.LeftLowerLeg),
        new BoneSpec("leftFoot", HumanBodyBones.LeftFoot),
        new BoneSpec("rightUpperLeg", HumanBodyBones.RightUpperLeg),
        new BoneSpec("rightLowerLeg", HumanBodyBones.RightLowerLeg),
        new BoneSpec("rightFoot", HumanBodyBones.RightFoot),
    };

    private static readonly ClipSpec[] Clips =
    {
        new ClipSpec("welcome_wave_08", "welcome", false, "Assets/Avatar151Review/Motions/02_welcome/guide_welcome_waving_01.fbx"),
        new ClipSpec("idle_neutral_04", "idle", true, "Assets/Avatar151Review/Motions/01_idle/guide_idle_neutral_01.fbx"),
        new ClipSpec("idle_or_think_19", "idle", true, "Assets/Avatar151Review/Motions50/02_think_confirm/19_think_thoughtful_head_nod_df3eb4.fbx"),
        new ClipSpec("think_looking_14", "thinking", true, "Assets/Avatar151Review/CodexMotions/think_looking_14.fbx"),
        new ClipSpec("talk_basic_14", "speaking", true, "Assets/Avatar151Review/Motions/03_talk_explain/guide_talk_basic_02.fbx"),
        new ClipSpec("talk_basic_15", "speaking", true, "Assets/Avatar151Review/Motions/03_talk_explain/guide_talk_basic_03.fbx"),
        new ClipSpec("talk_confirm_32", "speaking", true, "Assets/Avatar151Review/Motions50/02_think_confirm/32_think_同意_8cb80a.fbx"),
        new ClipSpec("talk_waist_48", "speaking", true, "Assets/Avatar151Review/Motions50/03_talk_explain/48_explain_叉腰讲话_4a7f3f.fbx"),
    };

    [MenuItem("Avatar151 Review/Bake Frontend Motions")]
    public static void BakeFrontendMotions()
    {
        var output = Environment.GetEnvironmentVariable("AVATAR151_BAKE_OUTPUT");
        if (string.IsNullOrWhiteSpace(output))
        {
            output = Path.GetFullPath(
                Path.Combine(
                    Application.dataPath,
                    "..",
                    "Builds",
                    "avatar151-baked-motions.json"
                )
            );
        }

        ConfigureModel();
        ConfigureMotionImports();
        AssetDatabase.Refresh();

        var avatar = FindHumanAvatar(ModelAsset);
        if (avatar == null)
        {
            throw new InvalidOperationException("151 model did not produce a Unity Humanoid avatar.");
        }

        var controller = CreateController();
        var modelPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(ModelAsset);
        if (modelPrefab == null)
        {
            throw new FileNotFoundException("151 model prefab not found.", ModelAsset);
        }

        var instance = PrefabUtility.InstantiatePrefab(modelPrefab) as GameObject;
        if (instance == null)
        {
            throw new InvalidOperationException("Could not instantiate 151 model prefab.");
        }

        instance.name = "Avatar151_Frontend_Bake_Model";
        var animator = instance.GetComponent<Animator>() ?? instance.AddComponent<Animator>();
        animator.avatar = avatar;
        animator.runtimeAnimatorController = controller;
        animator.applyRootMotion = false;
        animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        animator.updateMode = AnimatorUpdateMode.Normal;

        var armCorrection = instance.AddComponent<ArmOutwardCorrection>();
        armCorrection.animator = animator;
        armCorrection.correctionEnabled = true;
        armCorrection.globalStrength = 0.78f;

        var transforms = Bones.ToDictionary(spec => spec.Name, spec => animator.GetBoneTransform(spec.Bone));
        var baseLocalPositions = transforms.ToDictionary(pair => pair.Key, pair => pair.Value != null ? pair.Value.localPosition : Vector3.zero);
        var baseLocalRotations = transforms.ToDictionary(pair => pair.Key, pair => pair.Value != null ? pair.Value.localRotation : Quaternion.identity);

        var builder = new StringBuilder(1024 * 1024);
        builder.Append("{");
        JsonProp(builder, "schema", "avatar151-humanoid-bake-v1").Append(',');
        JsonProp(builder, "source", "Unity 2020 Humanoid retarget baked for frontend playback").Append(',');
        JsonProp(builder, "fps", BakeFps).Append(',');
        builder.Append("\"bones\":[");
        for (var i = 0; i < Bones.Length; i++)
        {
            if (i > 0) builder.Append(',');
            JsonString(builder, Bones[i].Name);
        }
        builder.Append("],\"baseQ\":[");
        for (var i = 0; i < Bones.Length; i++)
        {
            if (i > 0) builder.Append(',');
            WriteQuaternion(builder, baseLocalRotations[Bones[i].Name]);
        }
        builder.Append("],\"clips\":[");

        for (var clipIndex = 0; clipIndex < Clips.Length; clipIndex++)
        {
            if (clipIndex > 0) builder.Append(',');
            BakeClip(builder, Clips[clipIndex], animator, armCorrection, transforms, baseLocalPositions);
        }

        builder.Append("]}");

        Directory.CreateDirectory(Path.GetDirectoryName(output));
        File.WriteAllText(output, builder.ToString(), new UTF8Encoding(false));
        UnityEngine.Object.DestroyImmediate(instance);
        Debug.Log("[Avatar151FrontendMotionBaker] wrote " + output);
    }

    private static void ConfigureModel()
    {
        var importer = AssetImporter.GetAtPath(ModelAsset) as ModelImporter;
        if (importer == null) throw new FileNotFoundException("151 model not found.", ModelAsset);
        importer.animationType = ModelImporterAnimationType.Human;
        importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
        importer.importAnimation = false;
        importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
        importer.SaveAndReimport();
    }

    private static void ConfigureMotionImports()
    {
        foreach (var spec in Clips)
        {
            var importer = AssetImporter.GetAtPath(spec.AssetPath) as ModelImporter;
            if (importer == null)
            {
                throw new FileNotFoundException("Motion FBX not found in Unity project.", spec.AssetPath);
            }

            importer.animationType = ModelImporterAnimationType.Human;
            importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            importer.importAnimation = true;
            importer.materialImportMode = ModelImporterMaterialImportMode.None;
            var clips = importer.defaultClipAnimations;
            if (clips != null && clips.Length > 0)
            {
                for (var i = 0; i < clips.Length; i++)
                {
                    clips[i].loopTime = spec.Loop;
                    clips[i].loopPose = spec.Loop;
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
    }

    private static AnimatorController CreateController()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ControllerPath));
        if (File.Exists(ControllerPath)) AssetDatabase.DeleteAsset(ControllerPath);
        var controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
        var machine = controller.layers[0].stateMachine;
        machine.states = Array.Empty<ChildAnimatorState>();
        foreach (var spec in Clips)
        {
            var clip = FindPrimaryClip(spec.AssetPath);
            if (clip == null) throw new InvalidOperationException("Could not find animation clip in " + spec.AssetPath);
            var state = machine.AddState(spec.Name);
            state.motion = clip;
            state.writeDefaultValues = true;
            if (machine.defaultState == null) machine.defaultState = state;
        }
        AssetDatabase.SaveAssets();
        return controller;
    }

    private static void BakeClip(
        StringBuilder builder,
        ClipSpec spec,
        Animator animator,
        ArmOutwardCorrection armCorrection,
        Dictionary<string, Transform> transforms,
        Dictionary<string, Vector3> baseLocalPositions)
    {
        var clip = FindPrimaryClip(spec.AssetPath);
        if (clip == null) throw new InvalidOperationException("Could not find animation clip in " + spec.AssetPath);
        var duration = Mathf.Max(clip.length, 0.001f);
        var frameCount = Mathf.Max(2, Mathf.CeilToInt(duration * BakeFps) + 1);
        var sampleDuration = spec.Loop ? duration : Mathf.Min(duration, 4.2f);
        frameCount = Mathf.Max(2, Mathf.CeilToInt(sampleDuration * BakeFps) + 1);

        builder.Append('{');
        JsonProp(builder, "name", spec.Name).Append(',');
        JsonProp(builder, "group", spec.Group).Append(',');
        JsonProp(builder, "loop", spec.Loop).Append(',');
        JsonProp(builder, "duration", sampleDuration).Append(',');
        JsonProp(builder, "source", spec.AssetPath).Append(',');
        builder.Append("\"frames\":[");

        animator.Rebind();
        animator.Update(0f);

        for (var frame = 0; frame < frameCount; frame++)
        {
            if (frame > 0) builder.Append(',');
            var time = frameCount <= 1 ? 0f : (sampleDuration * frame / (frameCount - 1));
            var normalizedTime = spec.Loop ? Mathf.Repeat(time / duration, 1f) : Mathf.Clamp01(time / duration);

            animator.Play(spec.Name, 0, normalizedTime);
            animator.Update(0f);
            armCorrection.SendMessage("LateUpdate", SendMessageOptions.DontRequireReceiver);

            builder.Append('{');
            JsonProp(builder, "t", time).Append(',');
            builder.Append("\"p\":[");
            WriteVector(builder, transforms["hips"] != null ? transforms["hips"].localPosition : baseLocalPositions["hips"]);
            builder.Append("],\"q\":[");

            for (var i = 0; i < Bones.Length; i++)
            {
                if (i > 0) builder.Append(',');
                var transform = transforms[Bones[i].Name];
                var q = transform != null ? transform.localRotation : Quaternion.identity;
                WriteQuaternion(builder, q);
            }

            builder.Append("]}");
        }

        builder.Append("]}");
    }

    private static Avatar FindHumanAvatar(string assetPath)
    {
        return AssetDatabase.LoadAllAssetsAtPath(assetPath)
            .OfType<Avatar>()
            .FirstOrDefault(avatar => avatar != null && avatar.isHuman);
    }

    private static AnimationClip FindPrimaryClip(string assetPath)
    {
        return AssetDatabase.LoadAllAssetsAtPath(assetPath)
            .OfType<AnimationClip>()
            .Where(clip => clip != null && !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(clip => clip.length)
            .FirstOrDefault();
    }

    private static StringBuilder JsonProp(StringBuilder builder, string key, string value)
    {
        JsonString(builder, key);
        builder.Append(':');
        JsonString(builder, value);
        return builder;
    }

    private static StringBuilder JsonProp(StringBuilder builder, string key, bool value)
    {
        JsonString(builder, key);
        builder.Append(':').Append(value ? "true" : "false");
        return builder;
    }

    private static StringBuilder JsonProp(StringBuilder builder, string key, int value)
    {
        JsonString(builder, key);
        builder.Append(':').Append(value.ToString(CultureInfo.InvariantCulture));
        return builder;
    }

    private static StringBuilder JsonProp(StringBuilder builder, string key, float value)
    {
        JsonString(builder, key);
        builder.Append(':').Append(value.ToString("0.####", CultureInfo.InvariantCulture));
        return builder;
    }

    private static void JsonString(StringBuilder builder, string value)
    {
        builder.Append('"');
        foreach (var ch in value)
        {
            switch (ch)
            {
                case '\\': builder.Append("\\\\"); break;
                case '"': builder.Append("\\\""); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default: builder.Append(ch); break;
            }
        }
        builder.Append('"');
    }

    private static void WriteVector(StringBuilder builder, Vector3 value)
    {
        Float(builder, value.x).Append(',');
        Float(builder, value.y).Append(',');
        Float(builder, value.z);
    }

    private static void WriteQuaternion(StringBuilder builder, Quaternion value)
    {
        builder.Append('[');
        Float(builder, value.x).Append(',');
        Float(builder, value.y).Append(',');
        Float(builder, value.z).Append(',');
        Float(builder, value.w);
        builder.Append(']');
    }

    private static StringBuilder Float(StringBuilder builder, float value)
    {
        return builder.Append(value.ToString("0.#####", CultureInfo.InvariantCulture));
    }

    private sealed class ClipSpec
    {
        public readonly string Name;
        public readonly string Group;
        public readonly bool Loop;
        public readonly string AssetPath;

        public ClipSpec(string name, string group, bool loop, string assetPath)
        {
            Name = name;
            Group = group;
            Loop = loop;
            AssetPath = assetPath;
        }
    }

    private sealed class BoneSpec
    {
        public readonly string Name;
        public readonly HumanBodyBones Bone;

        public BoneSpec(string name, HumanBodyBones bone)
        {
            Name = name;
            Bone = bone;
        }
    }
}
