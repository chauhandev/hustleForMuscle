/**
 * Returns a date string in YYYY-MM-DD format using local time.
 * @param {Date} [date=new Date()] - The date to format.
 * @returns {string} - The formatted date string.
 */
export const getLocalDateFormat = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
