import { createClient } from '@supabase/supabase-js';

// 1. Supabase 클라이언트 초기화 (.env 환경 변수 활용)
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 2. 실시간 제보 등록 함수
 * @param {number} lat - 위도
 * @param {number} lng - 경도
 * @param {string} reportType - 제보 유형 ('CONSTR', 'STAIRS', 'HAZARD', 'SAFE')
 * @param {string} description - 상세 설명
 * @param {string|null} photoUrl - Supabase Storage 사진 URL (선택)
 */
export async function createReport(lat, lng, reportType, description, photoUrl = null) {
  // 현재 로그인한 사용자 정보 가져오기
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('reports')
    .insert([
      {
        user_id: user ? user.id : null, // 로그인한 경우 user_id 저장
        report_type: reportType,
        description: description,
        // PostGIS 지오메트리 형식으로 좌표 변환 (POINT(경도 위도))
        location: `POINT(${lng} ${lat})`,
        ...(photoUrl ? { photo_url: photoUrl } : {})
      }
    ])
    .select();

  if (error) {
    console.error('제보 등록 실패:', error.message);
    return { success: false, error };
  }
  
  console.log('제보 성공:', data);
  return { success: true, data };
}

/**
 * 3. TMAP 회피지점 설정을 위한 주변 제보 조회 함수 (PostGIS RPC 호출)
 * @param {number} lat - 현재 위치 위도
 * @param {number} lng - 현재 위치 경도
 * @param {number} radiusMeters - 반경(m) (기본값: 500m)
 */
export async function fetchNearbyReports(lat, lng, radiusMeters = 500) {
  const { data, error } = await supabase.rpc('get_nearby_reports', {
    user_lat: lat,
    user_lng: lng,
    radius_meters: radiusMeters
  });

  if (error) {
    console.error('주변 제보 조회 오류:', error.message);
    return [];
  }
  
  return data; // TMAP passList(경유지) 파라미터 생성 시 활용
}

/**
 * 4. 지도에 실시간 제보 마커 반영 (Supabase Realtime 구독)
 * @param {function} onNewReport - 새로운 제보 발생 시 실행할 콜백 함수
 */
export function subscribeToRealtimeReports(onNewReport) {
  const channel = supabase
    .channel('realtime_reports_channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reports' },
      (payload) => {
        console.log('새로운 실시간 제보 감지:', payload.new);
        if (onNewReport) onNewReport(payload.new);
      }
    )
    .subscribe();

  return channel; // 컴포넌트 언마운트 시 channel.unsubscribe() 호출용
}