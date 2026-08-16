using UnityEngine;

namespace Mungz.EnergyTrail.Tagger
{
    /// <summary>
    /// 술래 이동 + 회전 컨트롤러.
    /// 1차 MVP: WASD, 카메라 상대 방향. CharacterController 기반.
    /// Phase 2에서 TrailEmitter 추가, Phase 4에서 충돌 판정 추가.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    [RequireComponent(typeof(TaggerSpeedController))]
    public class TaggerController : MonoBehaviour
    {
        [SerializeField] private float gravity = -20f;
        [Tooltip("선택. FollowCamera가 있으면 카메라 forward 기준으로 이동")]
        [SerializeField] private Transform cameraTransform;

        private CharacterController cc;
        private TaggerSpeedController speed;
        private Vector3 input;
        private Vector3 velocity;

        private void Awake()
        {
            cc = GetComponent<CharacterController>();
            speed = GetComponent<TaggerSpeedController>();
        }

        private void Update()
        {
            ReadInput();
            ApplyMovement();
            ApplyRotation();
        }

        private void ReadInput()
        {
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
            float currentSpeed = speed.CurrentSpeed;
            Vector3 horizontal = moveDir * currentSpeed;

            // 중력
            if (cc.isGrounded && velocity.y < 0f) velocity.y = -2f;
            velocity.y += gravity * Time.deltaTime;

            Vector3 final = horizontal;
            final.y = velocity.y;
            cc.Move(final * Time.deltaTime);
        }

        private void ApplyRotation()
        {
            if (input.sqrMagnitude < 0.01f) return;

            Vector3 forward = GetCameraForward();
            Vector3 right = Vector3.Cross(Vector3.up, forward);
            Vector3 moveDir = (forward * input.z + right * input.x).normalized;
            if (moveDir.sqrMagnitude < 0.01f) return;

            Quaternion target = Quaternion.LookRotation(moveDir, Vector3.up);
            transform.rotation = Quaternion.RotateTowards(
                transform.rotation,
                target,
                speed.Config.rotationSpeed * Time.deltaTime
            );
        }
    }
}
