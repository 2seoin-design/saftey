import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_NAMES, completeCourseWalk } from './myPageService.js';

test('COURSE_NAMES는 5종 코스를 모두 포함한다', () => {
  assert.deepEqual(COURSE_NAMES, ['하트', '별', '마름모', '왕관', '기하학적 물고기']);
});

test('completeCourseWalk는 알 수 없는 코스명이면 RPC를 호출하지 않고 400 에러를 던진다', async () => {
  const client = {
    rpc: () => {
      throw new Error('알 수 없는 코스명일 때는 rpc가 호출되면 안 됨');
    },
  };

  await assert.rejects(
    () => completeCourseWalk(client, '삼각형'),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('completeCourseWalk는 RPC 결과의 첫 번째 행을 반환한다', async () => {
  const expectedRow = {
    completion_id: 1,
    course_name: '하트',
    completed_at: '2026-01-01T00:00:00.000Z',
    reward_granted: true,
    total_points: 200,
  };
  const client = {
    rpc: (fnName, args) => {
      assert.equal(fnName, 'complete_course_walk');
      assert.deepEqual(args, { p_course_name: '하트' });
      return Promise.resolve({ data: [expectedRow], error: null });
    },
  };

  const result = await completeCourseWalk(client, '하트');
  assert.deepEqual(result, expectedRow);
});
