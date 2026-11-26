import os
import subprocess
import sys

import pytest

# allows "import effects" / "import video_processor" as in the container, plus
# the shared video_common package and the captions and frame extraction stage
# services (DA-2), so the pipeline tests cover every stage
_here = os.path.dirname(__file__)
# (inserted in reverse, so the service directory comes first and "video" is
# this module, not the Tools/video package)
for _path in ("../../video_frames", "../../video_subtitles", "../..", ".."):
    sys.path.insert(0, os.path.abspath(os.path.join(_here, _path)))


def make_video(path, seconds=4, size="320x240", fps=25, audio=True, vcodec="libx264"):
    cmd = ["ffmpeg", "-y", "-v", "error",
           "-f", "lavfi", "-i", f"testsrc=size={size}:rate={fps}:duration={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                "-c:a", "aac"]
    cmd += ["-c:v", vcodec, "-pix_fmt", "yuv420p", "-shortest", path]
    subprocess.run(cmd, check=True)
    return path


@pytest.fixture
def sample_video(tmp_path):
    """Test video: 4 s, 320x240, 25 fps, with audio."""
    return make_video(str(tmp_path / "sample.mp4"))


@pytest.fixture
def silent_video(tmp_path):
    return make_video(str(tmp_path / "silent.mov"), seconds=2, audio=False)
