import { haversineMeters } from './geoUtils.js';
import { supabase } from './supabaseService.js';

const REWARD_THRESHOLD_PERCENT = 85;
const REWARD_AMOUNT = 200;

// 일치도 0%/100% 판정 기준 거리(m). 오차가 PERFECT 이하면 100%, ZERO 이상이면 0%,
// 그 사이는 선형 보간.
// ponytail: 도형 크기(마름모 200m vs 왕관 1.8km)에 비례한 허용치가 정확하지만
// 우선 모든 도형 공통 상수로 단순화함. 도형별 체감 난이도 차이가 크면
// maxRadiusKm에 비례해 조정할 것.
const PERFECT_MATCH_TOLERANCE_M = 15;
const ZERO_MATCH_TOLERANCE_M = 60;

function pointDistance(a, b) {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Discrete Fréchet distance: 두 궤적을 순서대로 따라갈 때 필요한 최소한의
 * "최대 결합 거리" (경로의 순서/굴곡을 보존하는 유사도 지표)
 */
export function frechetDistance(P, Q) {
  const n = P.length;
  const m = Q.length;
  const ca = Array.from({ length: n }, () => new Array(m).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const d = pointDistance(P[i], Q[j]);
      if (i === 0 && j === 0) ca[i][j] = d;
      else if (i === 0) ca[i][j] = Math.max(ca[0][j - 1], d);
      else if (j === 0) ca[i][j] = Math.max(ca[i - 1][0], d);
      else ca[i][j] = Math.max(Math.min(ca[i - 1][j], ca[i - 1][j - 1], ca[i][j - 1]), d);
    }
  }
  return ca[n - 1][m - 1];
}

/**
 * 대칭 Hausdorff distance: 순서 무시하고 두 궤적이 공간적으로 얼마나 겹치는지
 */
export function hausdorffDistance(P, Q) {
  const directed = (A, B) => Math.max(...A.map((a) => Math.min(...B.map((b) => pointDistance(a, b)))));
  return Math.max(directed(P, Q), directed(Q, P));
}

function distanceToPercent(meters) {
  const clamped = Math.max(
    0,
    Math.min(1, (ZERO_MATCH_TOLERANCE_M - meters) / (ZERO_MATCH_TOLERANCE_M - PERFECT_MATCH_TOLERANCE_M))
  );
  return Math.round(clamped * 100);
}

/**
 * 목표 경로와 사용자 GPS 궤적의 공간적 유사도(%)를 계산
 * @param {Array<{lat:number,lng:number}>} targetRouteCoords
 * @param {Array<{lat:number,lng:number,timestamp?:number}>} userGpsLogs
 */
export function computeSimilarityScore(targetRouteCoords, userGpsLogs) {
  const frechet = frechetDistance(targetRouteCoords, userGpsLogs);
  const hausdorff = hausdorffDistance(targetRouteCoords, userGpsLogs);
  const combinedError = (frechet + hausdorff) / 2;
  return { similarityScore: distanceToPercent(combinedError), frechet, hausdorff };
}

// shapeRouteService.js의 도형 key -> 마이페이지 "모양 달성 내역"에 쓰이는 공식 코스명.
// SHAPE_CONFIG.fish.label('물고기')과 다르게 여기서는 도형 5종의 공식 표기('기하학적 물고기')를 씀.
export const COURSE_NAME_BY_SHAPE = {
  rhombus: '마름모',
  heart: '하트',
  star: '별',
  fish: '기하학적 물고기',
  crown: '왕관',
};

/**
 * GPS 궤적-목표 경로 일치도 분석 및 리워드 지급 판정
 * @param {Array<{lat:number,lng:number}>} targetRouteCoords - 선택한 도형 산책로 좌표
 * @param {Array<{lat:number,lng:number,timestamp:number}>} userGpsLogs - 실제 GPS 궤적
 * @param {string} userId - Supabase auth 사용자 id
 * @param {keyof typeof COURSE_NAME_BY_SHAPE} shape - 완주 시도한 도형 key (예: 'heart')
 * @returns {Promise<{similarityScore:number, rewardEligible:boolean, message:string}>}
 */
export async function analyzeGpsSimilarity(targetRouteCoords, userGpsLogs, userId, shape) {
  if (!targetRouteCoords?.length || !userGpsLogs || userGpsLogs.length < 2) {
    return { similarityScore: 0, rewardEligible: false, message: 'GPS 기록이 부족해 분석할 수 없습니다.' };
  }

  const { similarityScore } = computeSimilarityScore(targetRouteCoords, userGpsLogs);

  if (similarityScore < REWARD_THRESHOLD_PERCENT) {
    return {
      similarityScore,
      rewardEligible: false,
      message: `일치도 ${similarityScore}%로 리워드 기준(${REWARD_THRESHOLD_PERCENT}%)에 못 미칩니다.`,
    };
  }

  const courseName = COURSE_NAME_BY_SHAPE[shape];
  if (!courseName) {
    return { similarityScore, rewardEligible: false, message: `알 수 없는 도형입니다: ${shape}` };
  }

  // complete_course_walk RPC가 내부적으로 claim_walk_reward(하루 1회 판정+지급)를 호출한 뒤
  // course_completions에 완주 내역을 기록함 (backend/data/mypage_rewards.sql 참고).
  const { data, error } = await supabase.rpc('complete_course_walk', {
    p_user_id: userId,
    p_course_name: courseName,
  });

  if (error) {
    return { similarityScore, rewardEligible: false, message: `리워드 지급 확인 중 오류: ${error.message}` };
  }

  const rewardGranted = data?.[0]?.reward_granted ?? false;
  if (!rewardGranted) {
    return { similarityScore, rewardEligible: false, message: '오늘은 이미 리워드를 받으셨습니다.' };
  }

  return {
    similarityScore,
    rewardEligible: true,
    message: `일치도 ${similarityScore}%! ${REWARD_AMOUNT}원 리워드가 지급되었습니다.`,
  };
}
