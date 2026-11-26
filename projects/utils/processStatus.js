const { imageTools, isVideoMedia } = require("./video");

// Snapshot of the project's current processing run, rebuilt from the
// persisted Process records so the frontend can recover it after a page
// refresh or a WebSocket reconnection.
//
// Steps follow the frontend's progress bar: one per (image, image tool) and
// one per video. A source whose Process record is gone has finished its chain.
function processStatus(project, processes) {
  const activeToken = project.activeToken || 0;
  const committedToken = project.committedToken || 0;
  const imgs = project.imgs || [];
  const toolCount = imageTools(project).length;
  const videoCount = imgs.filter(isVideoMedia).length;
  const total = toolCount * (imgs.length - videoCount) + videoCount;

  const running = (processes || []).filter(
    (p) => (p.token || 0) === activeToken && !/^preview/.test(p.msg_id || "")
  );

  if (running.length === 0) {
    return {
      running: false,
      // the run that opened activeToken has committed its results
      completed: activeToken > 0 && committedToken === activeToken,
      activeToken,
      total,
      done: 0,
    };
  }

  const pending = new Map(running.map((p) => [String(p.img_id), p]));
  let done = 0;
  for (const img of imgs) {
    const job = pending.get(String(img._id));
    if (isVideoMedia(img)) {
      // a video is a single step: it only counts once its reply is stored
      if (!job) done += 1;
    } else if (toolCount > 0) {
      // cur_pos = number of image tools this image has already gone through
      done += job ? Math.min(job.cur_pos || 0, toolCount) : toolCount;
    }
  }

  // progress events only reach the user who started the run
  const runnerId = String(running[0].runner_id || running[0].user_id || "");
  return { running: true, completed: false, activeToken, total, done, runnerId };
}

module.exports = { processStatus };
