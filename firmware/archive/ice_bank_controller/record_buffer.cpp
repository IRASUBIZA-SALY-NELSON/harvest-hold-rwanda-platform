#include "record_buffer.h"

#include <LittleFS.h>
#include <Preferences.h>

static const char* DIR = "/rec";

String RecordBuffer::path(uint32_t file) const { return String(DIR) + "/" + String(file) + ".bin"; }

uint32_t RecordBuffer::recordsIn(uint32_t file) const {
  File f = LittleFS.open(path(file), "r");
  if (!f) return 0;
  uint32_t n = f.size() / sizeof(Record);
  f.close();
  return n;
}

void RecordBuffer::saveHead() {
  Preferences p;
  p.begin("hhbuf", false);
  p.putUInt("file", first_);
  p.putUInt("head", head_);
  p.end();
}

bool RecordBuffer::begin(uint32_t capacity) {
  maxFiles_ = max<uint32_t>(2, (capacity + PER_FILE - 1) / PER_FILE);
  if (!LittleFS.begin(true)) return false;  // formats the partition the very first time
  if (!LittleFS.exists(DIR)) LittleFS.mkdir(DIR);

  bool any = false;
  File dir = LittleFS.open(DIR);
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    uint32_t n = strtoul(f.name(), nullptr, 10);
    if (!any || n < first_) first_ = n;
    if (!any || n > last_) last_ = n;
    any = true;
    f.close();
  }
  dir.close();

  Preferences p;
  p.begin("hhbuf", true);
  uint32_t headFile = p.getUInt("file", 0);
  head_ = p.getUInt("head", 0);
  p.end();

  if (!any) first_ = last_ = headFile + 1, head_ = 0;
  else if (headFile != first_) head_ = 0;  // the saved head file is gone: start at the oldest left

  count_ = 0;
  for (uint32_t f = first_; f <= last_; f++) count_ += recordsIn(f);
  head_ = min(head_, recordsIn(first_));
  count_ -= head_;
  lastCount_ = recordsIn(last_);
  ready_ = true;
  return true;
}

void RecordBuffer::push(const Record& r) {
  if (!ready_) return;
  if (lastCount_ >= PER_FILE) {
    last_++;
    lastCount_ = 0;
  }
  File f = LittleFS.open(path(last_), "a");
  if (!f) return;
  bool ok = f.write(reinterpret_cast<const uint8_t*>(&r), sizeof r) == sizeof r;
  f.close();
  if (!ok) return;
  lastCount_++;
  count_++;

  // Full: forget the oldest file.
  while (last_ - first_ + 1 > maxFiles_) {
    uint32_t lost = recordsIn(first_) - head_;
    LittleFS.remove(path(first_));
    first_++;
    head_ = 0;
    count_ -= lost;
    overwritten_ += lost;
    saveHead();
  }
}

uint32_t RecordBuffer::peek(Record* out, uint32_t max) {
  uint32_t got = 0, skip = head_;
  for (uint32_t file = first_; file <= last_ && got < max; file++) {
    File f = LittleFS.open(path(file), "r");
    if (!f) {
      skip = 0;
      continue;
    }
    if (skip) f.seek(skip * sizeof(Record));
    skip = 0;
    while (got < max && f.read(reinterpret_cast<uint8_t*>(&out[got]), sizeof(Record)) == sizeof(Record)) got++;
    f.close();
  }
  return got;
}

void RecordBuffer::drop(uint32_t n) {
  n = min(n, count_);
  count_ -= n;
  head_ += n;
  while (first_ < last_) {
    uint32_t inFirst = recordsIn(first_);
    if (head_ < inFirst) break;
    head_ -= inFirst;
    LittleFS.remove(path(first_));
    first_++;
  }
  saveHead();
}
