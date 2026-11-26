const test = require('node:test');
const assert = require('node:assert/strict');
const { processStatus } = require('../utils/processStatus');

const project = (extra = {}) => ({
  activeToken: 3,
  committedToken: 2,
  imgs: [
    { _id: 'i1', media_type: 'image' },
    { _id: 'i2', media_type: 'image' },
    { _id: 'v1', media_type: 'video' },
    { _id: 'v2', media_type: 'video' },
  ],
  tools: [
    { position: 0, procedure: 'brightness', params: {} },
    { position: 1, procedure: 'trim', params: { imgId: 'v1', start: 0, end: 1 } },
    { position: 2, procedure: 'contrast', params: {} },
  ],
  ...extra,
});

test('counts image steps by cur_pos and videos once finished', () => {
  // i1 finished, i2 is on its 2nd tool, v1 finished, v2 still running
  const processes = [
    { img_id: 'i2', cur_pos: 1, token: 3, msg_id: 'request-a', runner_id: 'u2', user_id: 'u1' },
    { img_id: 'v2', cur_pos: 0, token: 3, msg_id: 'request-b' },
  ];
  const status = processStatus(project(), processes);
  // 2 image tools x 2 images + 2 videos
  assert.equal(status.total, 6);
  assert.equal(status.done, 2 + 1 + 1);
  assert.equal(status.running, true);
  assert.equal(status.completed, false);
  assert.equal(status.runnerId, 'u2');
});

test('ignores previews and records from cancelled runs', () => {
  const processes = [
    { img_id: 'i1', cur_pos: 0, token: 3, msg_id: 'preview-x' },
    { img_id: 'i2', cur_pos: 0, token: 2, msg_id: 'request-old' },
  ];
  const status = processStatus(project(), processes);
  assert.equal(status.running, false);
  assert.equal(status.completed, false);
});

test('a run without records is completed only once it is committed', () => {
  assert.equal(processStatus(project({ committedToken: 3 }), []).completed, true);
  // a cancelled run bumps activeToken without committing it
  assert.equal(processStatus(project({ activeToken: 4, committedToken: 2 }), []).completed, false);
  assert.equal(processStatus(project({ activeToken: 0, committedToken: 0 }), []).completed, false);
});

test('images are not counted when the pipeline only has video effects', () => {
  const p = project({ tools: [{ position: 0, procedure: 'subtitles', params: {} }] });
  const status = processStatus(p, [{ img_id: 'v1', cur_pos: 0, token: 3, msg_id: 'request-v' }]);
  assert.equal(status.total, 2);
  assert.equal(status.done, 1);
});
