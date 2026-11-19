from pathlib import Path
import csv
import logging
import time
import traceback

from faster_whisper import WhisperModel, BatchedInferencePipeline

# ============================================================
# CONFIGURATION
# ============================================================

INPUT_DIR = Path("videos1")
OUTPUT_DIR = Path("videos1_out")

# Model: tiny, base, small, medium, large-v3, turbo
MODEL_SIZE = "large-v3"

# "cuda" for a compatible NVIDIA GPU; "cpu" otherwise
DEVICE = "cuda"
COMPUTE_TYPE = "float16"  # GPU: float16; CPU: int8

# None = automatically detect language
# Examples: "en", "hu", "de", "fr"
LANGUAGE = "hu"
BATCH_SIZE = 8       # Test 8 if VRAM allows

# Search subfolders for MP4 files?
RECURSIVE = False

# Generate timestamped SRT subtitle files?
SAVE_SRT = True

# Save plain text transcripts?
SAVE_TXT = True

# Quality/speed trade-off
BEAM_SIZE = 5
VAD_FILTER = True  # Filter long stretches of silence

# Use separate subfolders for transcripts and subtitles.
TXT_DIR = OUTPUT_DIR / "txt"
SRT_DIR = OUTPUT_DIR / "srt"

# ============================================================
# LOGGING
# ============================================================

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TXT_DIR.mkdir(parents=True, exist_ok=True)
SRT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=str(OUTPUT_DIR / "transcription.log"),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    encoding="utf-8",
)

CSV_PATH = OUTPUT_DIR / "progress.csv"


def load_completed():
    """Read successful files from the progress CSV."""
    completed = set()

    if CSV_PATH.exists():
        with CSV_PATH.open(
            "r", newline="", encoding="utf-8-sig"
        ) as f:
            for row in csv.DictReader(f):
                if row.get("status") == "OK":
                    completed.add(row["source"])

    return completed


def record_result(source, status, message="", seconds=0):
    """Append one result immediately, so progress survives interruption."""
    new_file = not CSV_PATH.exists()

    with CSV_PATH.open(
        "a", newline="", encoding="utf-8-sig"
    ) as f:
        writer = csv.writer(f)

        if new_file:
            writer.writerow(
                ["source", "status", "seconds", "message"]
            )

        writer.writerow(
            [str(source), status, round(seconds, 2), message]
        )


def format_srt_time(seconds):
    """Convert seconds to SRT timestamp format."""
    ms = round(seconds * 1000)
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)

    return (
        f"{hours:02}:{minutes:02}:"
        f"{secs:02},{ms:03}"
    )


def output_paths(video):
    """
    Preserve relative folders and avoid filename collisions
    when multiple videos have the same name.
    """
    relative = video.relative_to(INPUT_DIR)
    return (
        TXT_DIR / relative.with_suffix(".txt"),
        SRT_DIR / relative.with_suffix(".srt"),
    )


def transcribe_one(batched_model, video):
    txt_path, srt_path = output_paths(video)

    txt_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path.parent.mkdir(parents=True, exist_ok=True)

    segments, info = batched_model.transcribe(
        str(video),
        language=LANGUAGE,
        batch_size=BATCH_SIZE,
        beam_size=BEAM_SIZE,
        vad_filter=VAD_FILTER,
        condition_on_previous_text=False,
    )

    # Important: transcription runs as segments are consumed.
    # Write temporary output files, then rename on success.
    txt_tmp = txt_path.with_suffix(".txt.tmp")
    srt_tmp = srt_path.with_suffix(".srt.tmp")

    count = 0

    with txt_tmp.open("w", encoding="utf-8") as txt:
        srt = (
            srt_tmp.open("w", encoding="utf-8")
            if SAVE_SRT else None
        )

        try:
            for segment in segments:
                text = segment.text.strip()
                if not text:
                    continue

                txt.write(text + "\n")
                txt.flush()

                if srt is not None:
                    count += 1
                    srt.write(
                        f"{count}\n"
                        f"{format_srt_time(segment.start)} --> "
                        f"{format_srt_time(segment.end)}\n"
                        f"{text}\n\n"
                    )

            if srt is not None:
                srt.close()
                srt = None
        finally:
            if srt is not None:
                srt.close()

    # Publish only after transcription has completed successfully.
    txt_tmp.replace(txt_path)

    if SAVE_SRT:
        srt_tmp.replace(srt_path)

    return info.language, info.language_probability


def main():
    if not INPUT_DIR.is_dir():
        raise FileNotFoundError(
            f"Input folder does not exist: {INPUT_DIR}"
        )

    pattern = INPUT_DIR.rglob("*") if RECURSIVE else INPUT_DIR.glob("*")

    videos = sorted(
        (p for p in pattern if p.is_file()
         and p.suffix.lower() == ".mp4"),
        key=lambda p: str(p).casefold(),
    )

    completed = load_completed()

    # Also recognize existing transcripts when starting fresh
    # without a progress CSV entry.
    pending = []
    for video in videos:
        txt_path, srt_path = output_paths(video)

        outputs_exist = (
            SAVE_TXT and txt_path.is_file()
            and (not SAVE_SRT or srt_path.is_file())
        )

        if str(video) in completed or outputs_exist:
            continue

        pending.append(video)

    print(f"Found videos: {len(videos)}")
    print(f"Already completed: {len(videos) - len(pending)}")
    print(f"Remaining: {len(pending)}")
    print(f"Model: {MODEL_SIZE} | Device: {DEVICE}")
    print("Loading model...")

    # Load once, outside the video loop.
    model = WhisperModel(
        MODEL_SIZE,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )

    batched_model = BatchedInferencePipeline(model=model)

    total_start = time.time()

    for index, video in enumerate(pending, start=1):
        start = time.time()

        print(f"\n[{index}/{len(pending)}] {video}")

        try:
            language, probability = transcribe_one(batched_model, video)
            elapsed = time.time() - start

            record_result(
                video, "OK",
                f"language={language}, probability={probability:.3f}",
                elapsed,
            )

            logging.info(
                "OK: %s | language=%s | %.1fs",
                video, language, elapsed,
            )

            print(
                f"Done in {elapsed:.1f}s | "
                f"language={language} ({probability:.2f})"
            )

        except KeyboardInterrupt:
            print("\nInterrupted by user. Restart to resume.")
            raise

        except Exception as exc:
            elapsed = time.time() - start
            message = f"{type(exc).__name__}: {exc}"

            record_result(video, "ERROR", message, elapsed)
            logging.error(
                "Failed: %s\n%s", video, traceback.format_exc()
            )

            print(f"ERROR: {message}")
            # Continue to the next video.

        if index % 25 == 0 or index == len(pending):
            print(
                f"Progress: {index}/{len(pending)} "
                f"| elapsed: {(time.time() - total_start) / 60:.1f} min"
            )

    print("\nBatch finished.")
    print(f"Log: {OUTPUT_DIR / 'transcription.log'}")
    print(f"Progress CSV: {CSV_PATH}")


if __name__ == "__main__":
    main()
