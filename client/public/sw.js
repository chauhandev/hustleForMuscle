// HustleForMuscle Service Worker
// Handles scheduled workout reminder notifications

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    if (event.data?.type === 'CHECK_REMINDER') {
        const { reminderTime, todaysPushups } = event.data;

        // Already worked out today — no notification needed
        if (todaysPushups > 0) return;

        // Check if current local time matches the reminder time (within same minute)
        const now = new Date();
        const currentHH = now.getHours().toString().padStart(2, '0');
        const currentMM = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHH}:${currentMM}`;

        if (currentTime === reminderTime) {
            self.registration.showNotification('💪 HustleForMuscle Reminder', {
                body: "You haven't done pushups yet today! Don't break your streak 🔥",
                icon: '/logo.png',
                badge: '/logo.png',
                tag: 'workout-reminder', // Prevents duplicate notifications
                requireInteraction: false,
                vibrate: [200, 100, 200],
                data: { url: self.registration.scope }
            });
        }
    }
});

// Clicking the notification opens the app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If a window is already open, focus it
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (self.clients.openWindow) {
                return self.clients.openWindow(event.notification.data?.url || '/');
            }
        })
    );
});
