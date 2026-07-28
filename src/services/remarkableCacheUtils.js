function formatPageRange(pageNumbers) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    return '';
  }

  const sorted = [...new Set(pageNumbers.map(Number))].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  const flushRange = () => {
    if (start === end) {
      ranges.push(`P${start}`);
    } else if (end === start + 1) {
      ranges.push(`P${start},${end}`);
    } else {
      ranges.push(`P${start}〜${end}`);
    }
  };

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      flushRange();
      start = sorted[i];
      end = sorted[i];
    }
  }

  flushRange();
  return ranges.join(',');
}

module.exports = {
  formatPageRange,
};
