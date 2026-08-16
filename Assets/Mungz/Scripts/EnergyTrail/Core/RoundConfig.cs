using UnityEngine;

namespace Mungz.EnergyTrail.Core
{
    /// <summary>
    /// 라운드 설정을 담는 ScriptableObject.
    /// 1차 MVP (회색박스 프로토타입) 기준.
    /// </summary>
    [CreateAssetMenu(fileName = "RoundConfig", menuName = "EnergyTrail/RoundConfig", order = 0)]
    public class RoundConfig : ScriptableObject
    {
        [Header("라운드 시간")]
        [Tooltip("라운드 전체 길이 (초). 1차 MVP 검증 권장: 120~180")]
        public float roundDuration = 180f;

        [Tooltip("시작 전 카운트다운 (초)")]
        public float countdownDuration = 3f;

        [Header("승리 조건")]
        [Tooltip("술래 승리: 이 수만큼 도망자 OUT 시 술래 승")]
        public int taggerWinOutCount = 2;

        [Tooltip("도망자 승리: 이 수만큼 출구 도달 시 도망자 승")]
        public int runnerWinEscapeCount = 1;

        [Header("인원")]
        [Tooltip("도망자 수 (술래는 항상 1명)")]
        public int runnerCount = 3;

        [Header("OUT 처리 (1차 MVP)")]
        [Tooltip("OUT 시 도망자 즉시 제거(false) / 자리 유지 후 무력화(true). 1차: false")]
        public bool keepOutBodies = false;
    }
}
