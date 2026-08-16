using System;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;

namespace Mungz.EnergyTrail.Core
{
    public enum RoundState
    {
        Idle,
        Countdown,
        Playing,
        Ended
    }

    public enum RoundResult
    {
        None,
        TaggerWin,
        RunnerWin,
        Draw
    }

    /// <summary>
    /// 1차 MVP 회색박스 프로토타입의 라운드 매니저.
    /// - 상태머신: Idle → Countdown → Playing → Ended
    /// - 승패 판정: OUT 수, 출구 도달 수, 시간 초과
    /// - R 키로 라운드 재시작
    /// - UI/시스템은 이벤트로 구독
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        [Header("설정")]
        [SerializeField] private RoundConfig config;
        [Tooltip("재시작 시 로드할 씬 이름. 비워두면 현재 씬 리로드")]
        [SerializeField] private string restartSceneName = "";

        [Header("런타임 (Inspector 확인용)")]
        [SerializeField] private RoundState state = RoundState.Idle;
        [SerializeField] private RoundResult result = RoundResult.None;
        [SerializeField] private float remainingTime = 0f;
        [SerializeField] private int outCount = 0;
        [SerializeField] private int escapeCount = 0;

        // 이벤트
        public event Action<RoundState> OnStateChanged;
        public event Action<RoundResult> OnRoundEnded;
        public event Action<float> OnTimeChanged;
        public event Action<int> OnOutCountChanged;
        public event Action<int> OnEscapeCountChanged;

        // 프로퍼티
        public RoundConfig Config => config;
        public RoundState State => state;
        public RoundResult Result => result;
        public float RemainingTime => remainingTime;
        public int OutCount => outCount;
        public int EscapeCount => escapeCount;
        public int TotalRunners => config != null ? config.runnerCount : 0;
        public int AliveRunners => TotalRunners - outCount;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        private void Start()
        {
            if (config == null)
            {
                Debug.LogError("[GameManager] RoundConfig가 할당되지 않았습니다. GameManager 오브젝트에 RoundConfig를 드래그해서 연결하세요.");
                return;
            }
            StartCountdown();
        }

        private void Update()
        {
            if (state == RoundState.Playing)
            {
                remainingTime -= Time.deltaTime;
                if (remainingTime <= 0f)
                {
                    remainingTime = 0f;
                    // 시간 초과 = 출구 못 막은 술래 패배 → 도망자 승
                    EndRound(RoundResult.RunnerWin);
                }
                else
                {
                    OnTimeChanged?.Invoke(remainingTime);
                }
            }

            // R 키로 재시작 (Input System)
            if (Keyboard.current != null && Keyboard.current.rKey.wasPressedThisFrame)
            {
                RestartRound();
            }
        }

        public void StartCountdown()
        {
            state = RoundState.Countdown;
            remainingTime = config.roundDuration;
            outCount = 0;
            escapeCount = 0;
            result = RoundResult.None;
            OnStateChanged?.Invoke(state);
            OnTimeChanged?.Invoke(remainingTime);
            OnOutCountChanged?.Invoke(outCount);
            OnEscapeCountChanged?.Invoke(escapeCount);
            Invoke(nameof(BeginPlaying), config.countdownDuration);
        }

        private void BeginPlaying()
        {
            state = RoundState.Playing;
            OnStateChanged?.Invoke(state);
        }

        /// <summary>
        /// 도망자가 술래에게 잡혔을 때 호출. 승리 조건 충족 시 라운드 종료.
        /// </summary>
        public void ReportOut()
        {
            if (state != RoundState.Playing) return;
            outCount++;
            OnOutCountChanged?.Invoke(outCount);
            if (outCount >= config.taggerWinOutCount)
            {
                EndRound(RoundResult.TaggerWin);
            }
        }

        /// <summary>
        /// 도망자가 출구(EscapeZone)에 도달했을 때 호출.
        /// </summary>
        public void ReportEscape()
        {
            if (state != RoundState.Playing) return;
            escapeCount++;
            OnEscapeCountChanged?.Invoke(escapeCount);
            if (escapeCount >= config.runnerWinEscapeCount)
            {
                EndRound(RoundResult.RunnerWin);
            }
        }

        public void EndRound(RoundResult r)
        {
            if (state == RoundState.Ended) return;
            state = RoundState.Ended;
            result = r;
            OnStateChanged?.Invoke(state);
            OnRoundEnded?.Invoke(r);
        }

        public void RestartRound()
        {
            Time.timeScale = 1f; // 안전장치 (정지 상태에서 재시작 시)
            if (string.IsNullOrEmpty(restartSceneName))
            {
                SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
            }
            else
            {
                SceneManager.LoadScene(restartSceneName);
            }
        }
    }
}
