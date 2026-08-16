using UnityEngine;
using UnityEngine.InputSystem;

namespace Mungz.EnergyTrail.Camera
{
    /// <summary>
    /// 3인칭 추적 카메라. 1차 MVP (PC 검증용).
    /// - 우클릭 드래그: 카메라 회전 (yaw/pitch)
    /// - 마우스 휠: 줌 인/아웃
    /// 모바일 패스에선 가상 조이스틱과 터치 회전으로 재설계 (Phase 9).
    /// </summary>
    public class FollowCamera : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private float followSpeed = 12f;
        [SerializeField] private float rotateSpeed = 0.3f;
        [SerializeField] private float zoomSpeed = 5f;
        [SerializeField] private float minDistance = 3f;   // 줌인 한계
        [SerializeField] private float maxDistance = 15f;  // 줌아웃 한계
        [SerializeField] private float minPitch = -10f;
        [SerializeField] private float maxPitch = 70f;
        [SerializeField] private float lookHeight = 1.5f;  // 타겟 위 응시 높이

        private float yaw = 0f;
        private float pitch = 25f;
        private float currentDistance = 7f;

        public Transform Target { get => target; set => target = value; }

        private void Start()
        {
            if (target != null)
            {
                // 초기 yaw를 타겟-카메라 방향으로 설정
                Vector3 dir = transform.position - target.position;
                dir.y = 0f;
                if (dir.sqrMagnitude > 0.01f)
                {
                    yaw = Quaternion.LookRotation(dir).eulerAngles.y;
                }
            }
        }

        private void LateUpdate()
        {
            if (target == null) return;

            HandleInput();
            UpdateTransform();
        }

        private void HandleInput()
        {
            var mouse = Mouse.current;
            if (mouse == null) return;

            if (mouse.rightButton.isPressed)
            {
                Vector2 delta = mouse.delta.ReadValue();
                yaw += delta.x * rotateSpeed;
                pitch -= delta.y * rotateSpeed;
                pitch = Mathf.Clamp(pitch, minPitch, maxPitch);
            }

            float scroll = mouse.scroll.ReadValue().y;
            if (Mathf.Abs(scroll) > 0.01f)
            {
                currentDistance -= scroll * zoomSpeed * 0.01f;
                currentDistance = Mathf.Clamp(currentDistance, minDistance, maxDistance);
            }
        }

        private void UpdateTransform()
        {
            Quaternion rot = Quaternion.Euler(pitch, yaw, 0f);
            Vector3 offset = rot * new Vector3(0f, 0f, -currentDistance);
            Vector3 desired = target.position + offset;

            transform.position = Vector3.Lerp(
                transform.position,
                desired,
                followSpeed * Time.deltaTime
            );

            Vector3 lookAt = target.position + Vector3.up * lookHeight;
            transform.rotation = Quaternion.LookRotation((lookAt - transform.position).normalized);
        }
    }
}
