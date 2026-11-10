using UnityEngine;

public class ArmOutwardCorrection : MonoBehaviour
{
    public Animator animator;
    public bool correctionEnabled = true;
    [Range(0f, 1.5f)] public float globalStrength = 1.0f;
    [Range(0f, 1f)] public float categoryWeight = 0.8f;

    public float upperArmOutDegrees = 30f;
    public float upperArmForwardDegrees = 8f;
    public float lowerArmOutDegrees = 8f;

    private string currentCategory = "01_idle";
    private Transform leftUpperArm;
    private Transform rightUpperArm;
    private Transform leftLowerArm;
    private Transform rightLowerArm;
    private Transform leftHand;
    private Transform rightHand;

    private void Awake()
    {
        if (animator == null)
        {
            animator = GetComponentInChildren<Animator>();
        }
    }

    private void Start()
    {
        CacheBones();
    }

    private void LateUpdate()
    {
        if (!correctionEnabled || animator == null)
        {
            return;
        }

        if (leftUpperArm == null || rightUpperArm == null)
        {
            CacheBones();
        }

        ApplySide(leftUpperArm, leftLowerArm, leftHand, -1f);
        ApplySide(rightUpperArm, rightLowerArm, rightHand, 1f);
    }

    public void ToggleCorrection()
    {
        correctionEnabled = !correctionEnabled;
    }

    public void AdjustGlobalStrength(float delta)
    {
        globalStrength = Mathf.Clamp(globalStrength + delta, 0f, 1.5f);
    }

    public void SetPreset(float strength)
    {
        globalStrength = Mathf.Clamp(strength, 0f, 1.5f);
    }

    public void SetProfileForCategory(string category)
    {
        currentCategory = string.IsNullOrEmpty(category) ? "" : category;
        var lower = currentCategory.ToLowerInvariant();

        if (lower.Contains("idle"))
        {
            categoryWeight = 0.8f;
        }
        else if (lower.Contains("think") || lower.Contains("confirm"))
        {
            categoryWeight = 0.75f;
        }
        else if (lower.Contains("talk") || lower.Contains("explain"))
        {
            categoryWeight = 0.55f;
        }
        else if (lower.Contains("welcome") || lower.Contains("point") || lower.Contains("bow"))
        {
            categoryWeight = 0.2f;
        }
        else
        {
            categoryWeight = 0.45f;
        }
    }

    public string GetStatusText()
    {
        return string.Format(
            "{0} | strength {1:0.00} | profile {2:0.00} | [{3}]",
            correctionEnabled ? "Arm fix ON" : "Arm fix OFF",
            globalStrength,
            categoryWeight,
            currentCategory
        );
    }

    private void CacheBones()
    {
        if (animator == null)
        {
            return;
        }

        leftUpperArm = animator.GetBoneTransform(HumanBodyBones.LeftUpperArm);
        rightUpperArm = animator.GetBoneTransform(HumanBodyBones.RightUpperArm);
        leftLowerArm = animator.GetBoneTransform(HumanBodyBones.LeftLowerArm);
        rightLowerArm = animator.GetBoneTransform(HumanBodyBones.RightLowerArm);
        leftHand = animator.GetBoneTransform(HumanBodyBones.LeftHand);
        rightHand = animator.GetBoneTransform(HumanBodyBones.RightHand);
    }

    private void ApplySide(Transform upperArm, Transform lowerArm, Transform hand, float sideSign)
    {
        if (upperArm == null || lowerArm == null)
        {
            return;
        }

        var modelRight = transform.right;
        var modelForward = transform.forward;
        var upperDirection = (lowerArm.position - upperArm.position).normalized;
        var lowerDirection = hand != null ? (hand.position - lowerArm.position).normalized : upperDirection;

        var upperDownFactor = CalculateDownFactor(upperDirection);
        var lowerDownFactor = CalculateDownFactor(lowerDirection);
        var nearBodyFactor = CalculateNearBodyFactor(upperDirection, modelRight, sideSign);

        var upperWeight = globalStrength * categoryWeight * upperDownFactor * nearBodyFactor;
        var lowerWeight = globalStrength * categoryWeight * lowerDownFactor * nearBodyFactor;

        if (upperWeight > 0.001f)
        {
            var upperRotation =
                Quaternion.AngleAxis(sideSign * upperArmOutDegrees * upperWeight, modelForward) *
                Quaternion.AngleAxis(-upperArmForwardDegrees * upperWeight, modelRight);
            upperArm.rotation = upperRotation * upperArm.rotation;
        }

        if (lowerWeight > 0.001f)
        {
            var lowerRotation = Quaternion.AngleAxis(sideSign * lowerArmOutDegrees * lowerWeight, modelForward);
            lowerArm.rotation = lowerRotation * lowerArm.rotation;
        }
    }

    private static float CalculateDownFactor(Vector3 boneDirection)
    {
        return Mathf.Clamp01((-boneDirection.y - 0.12f) / 0.72f);
    }

    private static float CalculateNearBodyFactor(Vector3 upperDirection, Vector3 modelRight, float sideSign)
    {
        var outwardAmount = Vector3.Dot(upperDirection, modelRight * sideSign);
        return Mathf.Clamp01(1f - Mathf.Max(0f, outwardAmount) / 0.45f);
    }
}
