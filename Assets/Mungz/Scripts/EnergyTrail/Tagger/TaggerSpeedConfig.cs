using UnityEngine;

namespace Mungz.EnergyTrail.Tagger
{
    /// <summary>
    /// 술래 속도 단계 + 자국 생성 강도 설정.
    /// 1차 MVP: GPT 권장에 따라 3단계 (Walk / Run / Sprint).
    /// 부스트(2.4x, 5초, 쿨다운)는 2차로 연기 — 자국 밸런스 검증 후 재검토.
    /// </summary>
    [CreateAssetMenu(fileName = "TaggerSpeedConfig", menuName = "EnergyTrail/TaggerSpeedConfig", order = 1)]
    public class TaggerSpeedConfig : ScriptableObject
    {
        [Header("속도 배율 (1차 MVP: 3단계)")]
        [Tooltip("워크 (1.0x). 자국 안 남김. C 키 홀드.")]
        [Range(0.5f, 1.5f)] public float walkMultiplier = 1.0f;

        [Tooltip("런 (1.4x). 기본 이동. 자국 약함.")]
        [Range(1.0f, 2.0f)] public float runMultiplier = 1.4f;

        [Tooltip("스프린트 (1.8x). Shift 홀드. 자국 중간.")]
        [Range(1.5f, 2.5f)] public float sprintMultiplier = 1.8f;

        [Header("베이스 속도 (m/s)")]
        [Tooltip("배율 적용 전 술래 기본 이동 속도")]
        public float baseSpeed = 4.0f;

        [Header("자국 생성 강도 (0~1)")]
        [Tooltip("워크 자국 (1차: 0 = 자국 안 남김, 스텔스)")]
        [Range(0f, 1f)] public float walkTrailIntensity = 0f;

        [Tooltip("런 자국 강도 (0~1)")]
        [Range(0f, 1f)] public float runTrailIntensity = 0.4f;

        [Tooltip("스프린트 자국 강도 (0~1)")]
        [Range(0f, 1f)] public float sprintTrailIntensity = 0.8f;

        [Header("회전")]
        [Tooltip("캐릭터 회전 속도 (도/초)")]
        public float rotationSpeed = 720f;
    }
}
