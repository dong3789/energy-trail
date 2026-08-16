using UnityEngine;
using UnityEngine.InputSystem;

namespace Mungz.EnergyTrail.Tagger
{
    public enum TaggerSpeedTier
    {
        Walk,
        Run,
        Sprint
    }

    /// <summary>
    /// 술래 속도 단계 관리. 1차 MVP 3단계.
    /// - 기본: Run
    /// - C 홀드: Walk (자국 안 남김)
    /// - Shift 홀드: Sprint
    /// 동시 누를 시 Sprint 우선.
    /// Phase 2에서 TrailEmitter가 이 컨트롤러의 CurrentTrailIntensity를 읽어 자국 생성.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class TaggerSpeedController : MonoBehaviour
    {
        [SerializeField] private TaggerSpeedConfig config;

        public TaggerSpeedConfig Config => config;
        public TaggerSpeedTier CurrentTier { get; private set; } = TaggerSpeedTier.Run;

        public float CurrentSpeedMultiplier
        {
            get
            {
                if (config == null) return 1f;
                switch (CurrentTier)
                {
                    case TaggerSpeedTier.Walk: return config.walkMultiplier;
                    case TaggerSpeedTier.Sprint: return config.sprintMultiplier;
                    case TaggerSpeedTier.Run:
                    default: return config.runMultiplier;
                }
            }
        }

        public float CurrentSpeed
        {
            get
            {
                if (config == null) return 0f;
                return config.baseSpeed * CurrentSpeedMultiplier;
            }
        }

        public float CurrentTrailIntensity
        {
            get
            {
                if (config == null) return 0f;
                switch (CurrentTier)
                {
                    case TaggerSpeedTier.Walk: return config.walkTrailIntensity;
                    case TaggerSpeedTier.Sprint: return config.sprintTrailIntensity;
                    case TaggerSpeedTier.Run:
                    default: return config.runTrailIntensity;
                }
            }
        }

        private void Update()
        {
            if (config == null) return;
            var kb = Keyboard.current;
            if (kb == null) return;

            bool sprint = kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed;
            bool walk = kb.cKey.isPressed;

            if (sprint)
                CurrentTier = TaggerSpeedTier.Sprint;
            else if (walk)
                CurrentTier = TaggerSpeedTier.Walk;
            else
                CurrentTier = TaggerSpeedTier.Run;
        }
    }
}
