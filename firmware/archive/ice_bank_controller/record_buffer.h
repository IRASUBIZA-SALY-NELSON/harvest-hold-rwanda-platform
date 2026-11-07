#pragma once
#include "record.h"

/**
 * Readings waiting to be uploaded, kept in flash so they survive power cuts.
 *
 * Stored as a chain of small files (/rec/<n>.bin, 150 readings each, about one flash block).
 * Appending to a file and deleting whole files is cheap for flash; rewriting the middle of
 * one big file is not. When the buffer is full, the oldest file is deleted.
 * Only the network task uses it.
 */
class RecordBuffer {
 public:
  bool begin(uint32_t capacity);
  void push(const Record& r);
  uint32_t size() const { return count_; }
  /** Copies up to `max` of the oldest readings into `out`, without removing them. */
  uint32_t peek(Record* out, uint32_t max);
  /** Removes the `n` oldest readings (after they were uploaded). */
  void drop(uint32_t n);
  /** Readings lost because the buffer was full. */
  uint32_t overwritten() const { return overwritten_; }

 private:
  static const uint32_t PER_FILE = 150;
  String path(uint32_t file) const;
  uint32_t recordsIn(uint32_t file) const;
  void saveHead();

  uint32_t first_ = 0, last_ = 0;  // oldest and newest file numbers
  uint32_t head_ = 0;              // readings of the oldest file already uploaded
  uint32_t lastCount_ = 0;         // readings in the newest file
  uint32_t count_ = 0, maxFiles_ = 0, overwritten_ = 0;
  bool ready_ = false;
};
