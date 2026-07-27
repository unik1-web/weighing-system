function capitalizeWord(word: string): string {
  if (!word) return '';
  if (/^\d/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function capitalizeInitials(word: string): string {
  const parts = word.split('.');
  return parts
    .map((part, index) => {
      const formatted = part ? capitalizeWord(part) : '';
      return index < parts.length - 1 ? `${formatted}.` : formatted;
    })
    .join('');
}

export function formatPersonName(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text
    .split(' ')
    .map((word) => (word.includes('.') ? capitalizeInitials(word) : capitalizeWord(word)))
    .join(' ');
}

export function formatVehicleBrand(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.split(' ').map(capitalizeWord).join(' ');
}
