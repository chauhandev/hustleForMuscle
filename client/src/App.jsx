import React, { useState, useEffect, useCallback } from 'react';
import PushupTracker from './components/PushupTracker';
import Login from './components/Login';
import Calendar from './components/Calendar';
import InstallPrompt from './components/InstallPrompt';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, getRedirectResult } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, increment, onSnapshot, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { getLocalDateFormat } from './utils/dateUtils';

function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home');
  const [count, setCount] = useState(0);
  const [target, setTarget] = useState(10);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Stats State
  const [userStats, setUserStats] = useState({ totalPushups: 0, highestStreak: 0 });
  const [globalPushups, setGlobalPushups] = useState(0);

  // Daily Counter & Calendar State
  const [todaysPushups, setTodaysPushups] = useState(0);
  const [dailyWorkouts, setDailyWorkouts] = useState({});
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);

  // Reminder State (persisted in localStorage)
  const [reminderEnabled, setReminderEnabled] = useState(() =>
    JSON.parse(localStorage.getItem('reminderEnabled') || 'false')
  );
  const [reminderTime, setReminderTime] = useState(() =>
    localStorage.getItem('reminderTime') || '20:00'
  );
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  // Listen for new SW version
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('appUpdate', onUpdate);
    return () => window.removeEventListener('appUpdate', onUpdate);
  }, []);

  // Handle redirect result from Google Login (important for PWA)
  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          setUser(result.user); // Instantly set user to prevent flashing login screen
        }
      } catch (error) {
        console.error("Error during redirect validation", error);
      }
    };
    handleRedirect();
  }, []);

  // Auth Listener with error handling
  useEffect(() => {
    try {
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          try {
            const userRef = doc(db, "users", currentUser.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
              await setDoc(userRef, {
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                totalPushups: 0,
                highestStreak: 0,
                lastWorkoutDate: null
              });
            }
            setFirebaseReady(true);
          } catch (err) {
            console.error("Firestore error, using localStorage:", err);
            setFirebaseReady(false);
            loadLocalStats();
          }
        } else {
          setUser(null);
        }
      });
      return () => unsubscribe();
    } catch (err) {
      console.error("Firebase Auth error, using local mode:", err);
      // Fallback to local mode
      setUser({ displayName: 'Local User', photoURL: 'https://via.placeholder.com/40', uid: 'local' });
      setFirebaseReady(false);
      loadLocalStats();
    }
  }, []);

  // Load stats from localStorage
  const loadLocalStats = () => {
    const localStats = JSON.parse(localStorage.getItem('user_stats') || '{"totalPushups": 0, "highestStreak": 0}');
    setUserStats(localStats);
  };

  // Data Listener (User & Global) - only if Firebase is ready
  useEffect(() => {
    if (!user || !firebaseReady || user.uid === 'local') {
      loadLocalStats();
      return;
    }

    try {
      // Listen to User Stats
      const userUnsub = onSnapshot(doc(db, "users", user.uid), (doc) => {
        if (doc.exists()) {
          setUserStats(doc.data());
        }
      });

      // Listen to Global Daily Stats
      const today = getTodaysDate();
      const globalDailyRef = doc(db, "globals", "daily", "days", today);

      const globalUnsub = onSnapshot(globalDailyRef, (doc) => {
        if (doc.exists()) {
          setGlobalPushups(doc.data().count || 0);
        } else {
          setGlobalPushups(0);
        }
      });

      return () => { userUnsub(); globalUnsub(); };
    } catch (err) {
      console.error("Snapshot error:", err);
      loadLocalStats();
    }
  }, [user, firebaseReady]);

  // Helper: Get today's date string (YYYY-MM-DD)
  const getTodaysDate = () => {
    return getLocalDateFormat();
  };

  // Load daily workouts from Firestore (last 90 days)
  const loadDailyWorkouts = useCallback(async (userId) => {
    if (!firebaseReady || userId === 'local') {
      // Load from localStorage
      const localData = JSON.parse(localStorage.getItem('dailyWorkouts') || '{}');
      setDailyWorkouts(localData);
      calculateStreaks(localData);

      // Set today's count
      const today = getTodaysDate();
      setTodaysPushups(localData[today]?.pushups || 0);
      return;
    }

    try {
      const workoutsRef = collection(db, "users", userId, "dailyWorkouts");
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const q = query(
        workoutsRef,
        where("date", ">=", getLocalDateFormat(ninetyDaysAgo)),
        orderBy("date", "desc")
      );

      const querySnapshot = await getDocs(q);
      const workouts = {};
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        workouts[data.date] = data;
      });

      setDailyWorkouts(workouts);
      calculateStreaks(workouts);

      // Sync localStorage with Firestore (keeps calendar in sync, clears stale cache)
      localStorage.setItem('dailyWorkouts', JSON.stringify(workouts));

      // Set today's count
      const today = getTodaysDate();
      setTodaysPushups(workouts[today]?.pushups || 0);
    } catch (err) {
      console.error("Error loading daily workouts:", err);
    }
  }, [firebaseReady]);

  // Calculate current and longest streaks
  const calculateStreaks = useCallback((workouts) => {
    const dates = Object.keys(workouts).sort().reverse();
    if (dates.length === 0) {
      setCurrentStreak(0);
      setLongestStreak(0);
      return;
    }

    let current = 0;
    let longest = 0;
    let tempStreak = 0;
    const today = getTodaysDate();

    // Check current streak (must include today or yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateFormat(yesterday);

    if (workouts[today]?.pushups > 0) {
      current = 1;
      tempStreak = 1;

      // Count backwards
      for (let i = 1; i < 365; i++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - i);
        const dateStr = checkDate.toISOString().split('T')[0];

        if (workouts[dateStr]?.pushups > 0) {
          current++;
          tempStreak++;
        } else {
          break;
        }
      }
    } else if (workouts[yesterdayStr]?.pushups > 0) {
      current = 1;
      tempStreak = 1;

      // Count backwards from yesterday
      for (let i = 2; i < 365; i++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - i);
        const dateStr = checkDate.toISOString().split('T')[0];

        if (workouts[dateStr]?.pushups > 0) {
          current++;
          tempStreak++;
        } else {
          break;
        }
      }
    }

    longest = current;

    // Find longest streak in history
    for (let i = 0; i < dates.length; i++) {
      if (workouts[dates[i]]?.pushups > 0) {
        tempStreak = 1;

        for (let j = i + 1; j < dates.length; j++) {
          const prevDate = new Date(dates[j - 1]);
          const currDate = new Date(dates[j]);
          const dayDiff = (prevDate - currDate) / (1000 * 60 * 60 * 24);

          if (dayDiff === 1 && workouts[dates[j]]?.pushups > 0) {
            tempStreak++;
          } else {
            break;
          }
        }

        longest = Math.max(longest, tempStreak);
        i += tempStreak - 1;
      }
    }

    setCurrentStreak(current);
    setLongestStreak(longest);
  }, []);

  // Load daily workouts when user changes
  useEffect(() => {
    if (user) {
      loadDailyWorkouts(user.uid);
    }
  }, [user, firebaseReady]);

  // Reminder Scheduler — checks every 60s and posts to service worker
  useEffect(() => {
    if (!reminderEnabled) return;
    const tick = () => {
      navigator.serviceWorker?.ready.then((reg) => {
        reg.active?.postMessage({
          type: 'CHECK_REMINDER',
          reminderTime,
          todaysPushups
        });
      });
    };
    tick(); // Check immediately on enable
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [reminderEnabled, reminderTime, todaysPushups]);

  // Request notification permission and enable reminder
  const handleEnableReminder = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm !== 'granted') return;
    }
    const newVal = !reminderEnabled;
    setReminderEnabled(newVal);
    localStorage.setItem('reminderEnabled', JSON.stringify(newVal));
  };

  const handleReminderTimeChange = (e) => {
    setReminderTime(e.target.value);
    localStorage.setItem('reminderTime', e.target.value);
  };

  const handleCountChange = useCallback((newCount) => {
    setCount(newCount);
  }, []);

  const handleEndWorkout = useCallback(async () => {
    if (count > 0 && user) {
      const today = getTodaysDate();
      const sessionCount = count; // Capture session total

      // Update today's pushups and reset count ATOMICALLY in UI
      setTodaysPushups(prev => prev + sessionCount);
      setCount(0);

      // Save to localStorage FIRST
      const localStats = JSON.parse(localStorage.getItem('user_stats') || '{"totalPushups": 0}');
      localStats.totalPushups = (localStats.totalPushups || 0) + sessionCount;
      localStorage.setItem('user_stats', JSON.stringify(localStats));
      setUserStats(localStats);

      const localDailyWorkouts = JSON.parse(localStorage.getItem('dailyWorkouts') || '{}');
      const newDailyTotal = (localDailyWorkouts[today]?.pushups || 0) + sessionCount;
      localDailyWorkouts[today] = {
        date: today,
        pushups: newDailyTotal,
        sets: (localDailyWorkouts[today]?.sets || 0) + 1
      };
      localStorage.setItem('dailyWorkouts', JSON.stringify(localDailyWorkouts));
      setDailyWorkouts(localDailyWorkouts);
      calculateStreaks(localDailyWorkouts);

      // Firebase sync (Silent side-effect)
      if (firebaseReady && user.uid !== 'local') {
        try {
          const userRef = doc(db, "users", user.uid);
          const globalDailyRef = doc(db, "globals", "daily", "days", today);
          const dailyWorkoutRef = doc(db, "users", user.uid, "dailyWorkouts", today);

          await updateDoc(userRef, {
            totalPushups: increment(sessionCount),
            lastWorkoutDate: today
          });

          const dailySnap = await getDoc(dailyWorkoutRef);
          if (dailySnap.exists()) {
            await updateDoc(dailyWorkoutRef, {
              pushups: increment(sessionCount),
              sets: increment(1)
            });
          } else {
            await setDoc(dailyWorkoutRef, {
              date: today,
              pushups: sessionCount,
              sets: 1,
              timestamp: new Date()
            });
          }

          await setDoc(globalDailyRef, {
            count: increment(sessionCount)
          }, { merge: true });

          // DO NOT call loadDailyWorkouts here - it causes a race condition with stale data
        } catch (error) {
          console.warn("Sync failed (saved locally):", error);
        }
      }
    } else {
      setCount(0);
    }
    setView('home');
  }, [count, user, firebaseReady, calculateStreaks]);

  const handleLogout = () => {
    if (user.uid !== 'local') {
      signOut(auth);
    }
    setUser(null);
  };

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header - Responsive */}
      <header className="w-full p-3 sm:p-4 flex justify-between items-center border-b border-gray-800 sticky top-0 bg-gray-900 z-50">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="HustleForMuscle" className="h-8 sm:h-10 md:h-12 w-auto object-contain" />
          {!firebaseReady && <span className="text-xs text-yellow-500 font-bold">(Local Mode)</span>}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {view !== 'workout' && (
            <nav className="flex gap-2 sm:gap-4">
              <button
                onClick={() => setView('home')}
                className={`text-xs sm:text-sm md:text-base ${view === 'home' ? 'text-blue-400' : 'text-gray-400'} hover:text-blue-300 transition-colors`}
              >
                Home
              </button>
              <button
                onClick={() => setView('settings')}
                className={`text-xs sm:text-sm md:text-base ${view === 'settings' ? 'text-blue-400' : 'text-gray-400'} hover:text-blue-300 transition-colors`}
              >
                Settings
              </button>
            </nav>
          )}

          {/* Profile Avatar + Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowProfile(prev => !prev)}
              className="flex items-center gap-2 rounded-full focus:outline-none"
            >
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=4f46e5&color=fff`} alt="User" className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-gray-600 hover:border-blue-400 transition-colors" />
            </button>

            {showProfile && (
              <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700">
                  <p className="text-sm font-semibold text-white truncate">{user.displayName || 'Anonymous'}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{user.email || ''}</p>
                </div>
                <button
                  onClick={() => { setShowProfile(false); handleLogout(); }}
                  className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-gray-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 md:p-6">
        {view === 'home' && (
          <div className="text-center w-full max-w-4xl">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold mb-4 sm:mb-6 px-2">
              Hello, {user.displayName ? user.displayName.split(' ')[0] : 'Grinder'} 👋
            </h2>

            {/* Stats Grid - Responsive */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl mx-auto mb-6 sm:mb-8 px-2">
              <div className="bg-gray-800 p-4 sm:p-6 rounded-xl border border-gray-700">
                <p className="text-gray-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">Today</p>
                <p className="text-2xl sm:text-3xl font-bold text-green-400">{todaysPushups + count}</p>
              </div>
              <div className="bg-gray-800 p-4 sm:p-6 rounded-xl border border-gray-700">
                <p className="text-gray-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">🔥 Streak</p>
                <p className="text-2xl sm:text-3xl font-bold text-orange-500">{currentStreak}d</p>
              </div>
              <div className="bg-gray-800 p-4 sm:p-6 rounded-xl border border-gray-700">
                <p className="text-gray-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">Lifetime Total</p>
                <p className="text-2xl sm:text-3xl font-bold text-blue-500">{(userStats.totalPushups || 0) + count}</p>
              </div>
              <div className="bg-gray-800 p-4 sm:p-6 rounded-xl border border-gray-700 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-1 bg-purple-600 text-[8px] sm:text-[10px] font-bold rounded-bl-lg">
                  {firebaseReady ? 'LIVE' : 'LOCAL'}
                </div>
                <p className="text-gray-400 text-[10px] sm:text-xs uppercase tracking-wider mb-1">Global Today</p>
                <p className="text-2xl sm:text-3xl font-bold text-purple-400">
                  {firebaseReady ? globalPushups.toLocaleString() : 'Offline'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={() => setView('workout')}
                className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-full text-lg font-bold transition-all shadow-lg hover:shadow-blue-500/50"
              >
                Start Workout
              </button>
              <button
                onClick={() => setView('calendar')}
                className="w-full sm:w-auto px-8 py-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-lg font-bold transition-all"
              >
                📅 View Calendar
              </button>
            </div>
          </div>
        )}

        {view === 'calendar' && (
          <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Calendar
              dailyWorkouts={dailyWorkouts}
              currentStreak={currentStreak}
              longestStreak={longestStreak}
            />
            <div className="mt-8 text-center">
              <button
                onClick={() => setView('home')}
                className="px-6 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-all"
              >
                Back to Home
              </button>
            </div>
          </div>
        )}

        {view === 'workout' && (
          <div className="w-full h-full flex flex-col items-center justify-center max-w-6xl">
            <div className="relative w-full aspect-video bg-gray-800 rounded-lg sm:rounded-xl overflow-hidden shadow-2xl border border-gray-700">
              <PushupTracker onCountChange={handleCountChange} onEnd={handleEndWorkout} />
            </div>
          </div>
        )}

        {view === 'settings' && (
          <div className="w-full max-w-md mx-2 space-y-4">
            {/* Target Reps Card */}
            <div className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-xl border border-gray-700">
              <h3 className="text-xl sm:text-2xl font-bold mb-4">Configuration</h3>
              <div>
                <label className="block text-gray-400 mb-2 text-sm">Target Reps</label>
                <input
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(parseInt(e.target.value) || 0)}
                  className="w-full bg-gray-700 text-white p-2.5 rounded-lg border border-gray-600 focus:border-blue-500 outline-none text-sm"
                />
              </div>
            </div>

            {/* Reminder Card */}
            <div className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-xl border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">🔔 Daily Reminder</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Get notified to protect your streak</p>
                </div>
                {/* Toggle Switch */}
                <button
                  onClick={handleEnableReminder}
                  className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors focus:outline-none ${reminderEnabled ? 'bg-blue-600' : 'bg-gray-600'
                    }`}
                  style={{ width: '52px' }}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${reminderEnabled ? 'translate-x-7' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>

              {/* Time Picker — shown when enabled */}
              {reminderEnabled && (
                <div className="mt-3">
                  <label className="block text-gray-400 mb-2 text-sm">Reminder Time</label>
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={handleReminderTimeChange}
                    className="w-full bg-gray-700 text-white p-2.5 rounded-lg border border-gray-600 focus:border-blue-500 outline-none text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    You'll be notified at <span className="text-blue-400 font-semibold">{reminderTime}</span> if you haven't worked out yet.
                  </p>
                </div>
              )}

              {/* Permission Warning */}
              {notifPermission === 'denied' && (
                <p className="mt-3 text-xs text-red-400">
                  ⚠️ Notification permission is blocked. Enable it in your browser/device settings.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
      <InstallPrompt />

      {/* Update Available Banner */}
      {updateAvailable && (
        <div className="fixed bottom-0 left-0 right-0 z-[999] flex items-center justify-between gap-3 px-4 py-3 bg-blue-600 text-white shadow-2xl">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>🚀</span>
            <span>New version available!</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 bg-white text-blue-700 font-bold text-xs rounded-full hover:bg-blue-50 transition-colors"
            >
              Update Now
            </button>
            <button
              onClick={() => setUpdateAvailable(false)}
              className="text-white/70 hover:text-white text-xs underline"
            >
              Later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
