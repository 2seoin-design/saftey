import * as turf from '@turf/turf';
import { haversineMeters } from './geoUtils.js';

const BUFFER_RADIUS_KM = 0.015; // 15m
const REWARD_THRESHOLD_PERCENT = 85;

// 포함비율과 DTW를 종합할 때의 가중치 - 포함비율(공간적으로 버퍼 안에 있었는가)을
// 더 중요하게 보고, DTW(순서/정렬 유사도)는 보조 지표로 사용
const CONTAINMENT_WEIGHT = 0.6;
const DTW_WEIGHT = 0.4;

// DTW 점수를 0~100%로 환산할 때 기준 - 평균 정렬 오차가 이 거리(m) 이내면 100%,
// 이 거리 이상이면 0%
const DTW_PERFECT_M = 15;
const DTW_ZERO_M = 60;

function toLngLat(path) {
  return path.map((p) => [p.lng, p.lat]);
}

/**
 * Discrete DTW(Dynamic Time Warping) - 두 궤적의 "순서를 보존한" 정렬 비용 합.
 * 표준 DP 알고리즘, 포인트 간 거리는 haversine(m) 사용.
 */
export function dtwDistance(targetPath, userPath) {
  const n = targetPath.length;
  const m = userPath.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dp[0][0] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = haversineMeters(targetPath[i - 1].lat, targetPath[i - 1].lng, userPath[j - 1].lat, userPath[j - 1].lng);
      dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[n][m];
}

/**
 * 기준 경로에 15m 버퍼를 씌워, 사용자 좌표 중 버퍼 안에 들어온 비율을 계산 (0~1)
 */
export function computeContainmentRatio(targetPath, userPath) {
  if (targetPath.length < 2 || userPath.length === 0) return 0;

  const line = turf.lineString(toLngLat(targetPath));
  const buffer = turf.buffer(line, BUFFER_RADIUS_KM, { units: 'kilometers' });

  const insideCount = userPath.filter((p) => turf.booleanPointInPolygon(turf.point([p.lng, p.lat]), buffer)).length;
  return insideCount / userPath.length;
}

/**
 * 목표 산책로와 사용자 GPS 궤적의 일치율(0~100%)을 산출.
 * 15m 버퍼 포함비율(60%) + DTW 정렬 유사도(40%)를 종합.
 * @param {{lat:number,lng:number}[]} targetPath
 * @param {{lat:number,lng:number}[]} userPath
 */
export function computeMatchPercent(targetPath, userPath) {
  if (targetPath.length < 2 || userPath.length < 2) {
    return { matchPercent: 0, containmentRatio: 0, dtwMeters: null };
  }

  const containmentRatio = computeContainmentRatio(targetPath, userPath);

  const dtwMeters = dtwDistance(targetPath, userPath);
  const avgDtwPerPoint = dtwMeters / Math.max(targetPath.length, userPath.length);
  const dtwScore = Math.max(0, Math.min(1, (DTW_ZERO_M - avgDtwPerPoint) / (DTW_ZERO_M - DTW_PERFECT_M)));

  const matchPercent = Math.round((containmentRatio * CONTAINMENT_WEIGHT + dtwScore * DTW_WEIGHT) * 100);

  return { matchPercent, containmentRatio, dtwMeters };
}

export function isRewardEligible(matchPercent) {
  return matchPercent >= REWARD_THRESHOLD_PERCENT;
}

export { REWARD_THRESHOLD_PERCENT };
