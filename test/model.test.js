import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoster, parseRosterText, mergeRoster, chooseNumber, validateDraw, validateMathCode, assignmentSummary, markOf, nextMark, MARK,
} from '../public/js/lib/model.js';

test('명단 정리: 번호순, id 생성, 중복·빈 이름 오류', () => {
  const r = normalizeRoster([{ no: '2', name: ' 이서연 ' }, { no: '1', name: '김민준' }, { no: '', name: '' }]);
  assert.deepEqual(r.map((s) => [s.no, s.name]), [['1', '김민준'], ['2', '이서연']]);
  assert.match(r[0].id, /^s_[0-9a-f]{8}$/);
  assert.throws(() => normalizeRoster([{ no: '1', name: 'a' }, { no: '1', name: 'b' }]), /두 번/);
  assert.throws(() => normalizeRoster([{ no: '3', name: '' }]), /이름이 비어/);
});

test('붙여넣기 명단 읽기', () => {
  const r = parseRosterText('1 김민준\n2\t이서연\n3번 박도윤\n4. 최하은\n\n정시우');
  assert.deepEqual(r, [
    { no: '1', name: '김민준' }, { no: '2', name: '이서연' }, { no: '3', name: '박도윤' },
    { no: '4', name: '최하은' }, { no: '5', name: '정시우' },
  ]);
});

test('명단 합치기: 같은 번호는 id 유지', () => {
  const merged = mergeRoster([{ id: 's_aaaaaaaa', no: '1', name: '옛이름' }], [{ no: '1', name: '새이름' }, { no: '2', name: '추가' }]);
  assert.deepEqual(merged, [{ id: 's_aaaaaaaa', no: '1', name: '새이름' }, { id: '', no: '2', name: '추가' }]);
});

test('남은 번호에서 고르기', () => {
  assert.equal(chooseNumber(1, 3, new Set([1, 2]), () => 0.99), 3);
  assert.equal(chooseNumber(1, 2, new Set([1, 2])), null);
});

test('뽑기·반코드 검사', () => {
  assert.deepEqual(validateDraw({ title: ' 자리 ', min: '1', max: '18' }), { title: '자리', min: 1, max: 18 });
  assert.throws(() => validateDraw({ title: 'x', min: 5, max: 2 }));
  assert.throws(() => validateDraw({ title: '', min: 1, max: 2 }));
  assert.equal(validateMathCode(' abc123 '), 'ABC123');
  assert.equal(validateMathCode(''), '');
  assert.throws(() => validateMathCode('한글'));
});

test('과제 요약', () => {
  const students = [{ id: 'a', no: '1' }, { id: 'b', no: '2' }];
  const s = assignmentSummary({ done: { a: 't' } }, students);
  assert.equal(s.doneCount, 1);
  assert.deepEqual(s.missing.map((x) => x.id), ['b']);
});

test('과제 요약: 중간(노랑)은 통과에도 아직에도 안 들어감', () => {
  const students = [{ id: 'a', no: '1' }, { id: 'b', no: '2' }, { id: 'c', no: '3' }];
  const s = assignmentSummary({ done: { a: 't' }, half: { b: 't' } }, students);
  assert.equal(s.doneCount, 1);
  assert.equal(s.halfCount, 1);
  assert.deepEqual(s.half.map((x) => x.id), ['b']);
  assert.deepEqual(s.missing.map((x) => x.id), ['c']);
  // half 가 없는 예전 기록도 그대로 읽힘
  assert.equal(assignmentSummary({ done: {} }, students).halfCount, 0);
});

test('터치 순서: 안 함 → 중간 → 통과 → 안 함', () => {
  assert.equal(nextMark(MARK.NONE), MARK.HALF);
  assert.equal(nextMark(MARK.HALF), MARK.DONE);
  assert.equal(nextMark(MARK.DONE), MARK.NONE);
  assert.equal(markOf({ done: { a: 't' }, half: { a: 't' } }, 'a'), MARK.DONE); // 둘 다 있으면 통과 우선
  assert.equal(markOf({ half: { a: 't' } }, 'a'), MARK.HALF);
  assert.equal(markOf({}, 'a'), MARK.NONE);
});
