import React, { useState, useEffect } from 'react';
import { getLocalDateFormat } from '../utils/dateUtils';

const Calendar = ({ dailyWorkouts, currentStreak, longestStreak }) => {
    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Get last 90 days for the heatmap
    const getLast90Days = () => {
        const days = [];
        const today = new Date();
        for (let i = 89; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            days.push(date);
        }
        return days;
    };

    const getDateString = (date) => {
        return getLocalDateFormat(date);
    };

    const getIntensityColor = (count) => {
        if (!count || count === 0) return 'bg-gray-800 border-gray-700';
        if (count < 20) return 'bg-green-900/40 border-green-700';
        if (count < 50) return 'bg-green-700/60 border-green-500';
        if (count < 100) return 'bg-green-500/80 border-green-400';
        return 'bg-green-400 border-green-300';
    };

    const isToday = (date) => {
        const today = new Date();
        return getDateString(date) === getDateString(today);
    };

    const days = getLast90Days();
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Group days by week
    const weeks = [];
    let currentWeek = [];
    days.forEach((day, index) => {
        currentWeek.push(day);
        if (day.getDay() === 6 || index === days.length - 1) {
            weeks.push([...currentWeek]);
            currentWeek = [];
        }
    });

    return (
        <div className="w-full max-w-4xl mx-auto p-6 bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl">
            {/* Header */}
            <div className="mb-6">
                <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                    Your Workout Calendar 🔥
                </h2>
                <div className="flex gap-4 text-sm">
                    <div className="px-4 py-2 bg-orange-500/20 border border-orange-500/50 rounded-lg">
                        <span className="text-gray-400">Current Streak:</span>
                        <span className="ml-2 text-orange-400 font-bold">{currentStreak} days</span>
                    </div>
                    <div className="px-4 py-2 bg-purple-500/20 border border-purple-500/50 rounded-lg">
                        <span className="text-gray-400">Best Streak:</span>
                        <span className="ml-2 text-purple-400 font-bold">{longestStreak} days</span>
                    </div>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="mb-4">
                <div className="grid grid-cols-7 gap-2 mb-2">
                    {weekDays.map(day => (
                        <div key={day} className="text-center text-xs text-gray-500 font-semibold">
                            {day}
                        </div>
                    ))}
                </div>

                <div className="space-y-2">
                    {weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="grid grid-cols-7 gap-2">
                            {/* Fill empty cells at start of first week */}
                            {weekIndex === 0 && week[0].getDay() > 0 &&
                                Array(week[0].getDay()).fill(null).map((_, i) => (
                                    <div key={`empty-${i}`} className="aspect-square" />
                                ))
                            }

                            {week.map((date) => {
                                const dateStr = getDateString(date);
                                const workout = dailyWorkouts[dateStr];
                                const count = workout?.pushups || 0;
                                const today = isToday(date);

                                return (
                                    <div
                                        key={dateStr}
                                        className={`
                                            aspect-square rounded-lg border-2 flex flex-col items-center justify-center
                                            transition-all duration-200 hover:scale-110 hover:shadow-lg
                                            ${getIntensityColor(count)}
                                            ${today ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}
                                            cursor-pointer group relative
                                        `}
                                        title={`${date.toLocaleDateString()}: ${count} pushups`}
                                    >
                                        <span className="text-xs font-semibold text-gray-300">
                                            {date.getDate()}
                                        </span>
                                        {count > 0 && (
                                            <span className="text-[10px] text-green-300 font-bold">
                                                {count}
                                            </span>
                                        )}

                                        {/* Tooltip */}
                                        <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                                            <div className="bg-gray-950 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-gray-700 whitespace-nowrap">
                                                <div className="font-semibold">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                                <div className="text-green-400">{count} pushups</div>
                                                {workout?.sets && <div className="text-gray-400">{workout.sets} sets</div>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mt-6 pt-4 border-t border-gray-700">
                <span>Less</span>
                <div className="w-4 h-4 rounded bg-gray-800 border border-gray-700"></div>
                <div className="w-4 h-4 rounded bg-green-900/40 border border-green-700"></div>
                <div className="w-4 h-4 rounded bg-green-700/60 border border-green-500"></div>
                <div className="w-4 h-4 rounded bg-green-500/80 border border-green-400"></div>
                <div className="w-4 h-4 rounded bg-green-400 border border-green-300"></div>
                <span>More</span>
            </div>
        </div>
    );
};

export default Calendar;
