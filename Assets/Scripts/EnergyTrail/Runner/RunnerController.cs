using UnityEngine;

namespace Mungz.EnergyTrail.Runner
{
    /// <summary>
    /// 도망자 이동 + 회전 컨트롤러.
    /// 1차 MVP: WASD, 카메라 상대 방향. CharacterController 기반.
    /// Phase 3의 TrailAbsorber가 IsInputBlocked / SetSpeedMultiplier를 제어.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class RunnerController : MonoBehaviour
    {
        [SerializeField] private float baseSpeed = 4.5f; // 도망자가 살짝 더 빠름 (기본 추격 벌기)
        [SerializeField] private float gravity = -20f;
        [Tooltip("선택. FollowCamera가 있으면 카메라 forward 기준으로 이동")]
        [SerializeField] private Transform cameraTransform;
        [SerializeField] private float rotationSpeed = 720f;

        private CharacterController cc;
        private Vector3 input;
        private Vector3 velocity;
        private float speedMultiplier = 1f;

        /// <summary>흡수 중 true로 설정하면 입력 무시. Phase 3의 TrailAbsorber가 제어.</summary>
        public bool IsInputBlocked { get; set; } = false;

        public float CurrentSpeed => baseSpeed * speedMultiplier;

        private void Awake()
        {
            cc = GetComponent<CharacterController>();
        }

        private void Update()
        {
            ReadInput();
            ApplyMovement();
            ApplyRotation();
        }

        /// <summary>외부(흡수 시스템)에서 속도 배율 제어.</summary>
        public void SetSpeedMultiplier(float m) => speedMultiplier = Mathf.Max(0f, m);

        private void ReadInput()
        {
            if (IsInputBlocked) { input = Vector3.zero; return; }

            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb == null) { input = Vector3.zero; return; }

            float h = 0f, v = 0f;
            if (kb.aKey.isPressed) h -= 1f;
            if (kb.dKey.isPressed) h += 1f;
            if (kb.wKey.isPressed) v += 1f;
            if (kb.sKey.isPressed) v -= 1f;

            input = new Vector3(h, 0f, v);
            if (input.sqrMagnitude > 1f) input.Normalize();
        }

        private Vector3 GetCameraForward()
        {
            return cameraTransform != null
                ? Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up).normalized
                : transform.forward;
        }

        private void ApplyMovement()
        {
            Vector3 forward = GetCameraForward();
            Vector3 right = Vector3.Cross(Vector3.up, forward);

            Vector3 moveDir = forward * input.z + right * input.x;
            Vector3 horizontal = moveDir * CurrentSpeed;

            if (cc.isGrounded && velocity.y < 0f) velocity.y = -2f;
            velocity.y += gravity * Time.deltaTime;

            Vector3 final = horizontal;
            final.y = velocity.y;
            cc.Move(final * Time.deltaTime);
        }

        private void ApplyRotation()
        {
            if (IsInputBlocked || input.sqrMagnitude < 0.01f) return;

            Vector3 forward = GetCameraForward();
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            Vector3 moveDir = (forward * input.z + right * input.x).normalized;
            if (moveDir.sqrMagnitude < 0.01f) return;

            Quaternion target = Quaternion.LookRotation(moveDir, Vector3.up);
            transform.rotation = Quaternion.RotateTowards(
                transform.rotation,
                target,
                rotationSpeed * Time.deltaTime
            );
        }
    }
}
