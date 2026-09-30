# Presenter Remote — Android app

A small native app that connects your phone to Presenter running on your computer.
It shows the same remote as the web page, plus: it remembers the computer's address,
keeps the screen awake, and the **volume keys** work as Prev / Next.

## Build the APK (one time, on your computer)
1. Install Android Studio (free): https://developer.android.com/studio
2. **File → Open** and pick this `phone-app-android` folder. Let it sync
   (it may offer to install Android SDK 34 — accept).
3. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. When it finishes, click **locate**. The file is `app/build/outputs/apk/debug/app-debug.apk`.
5. Send that file to your phone (USB, email, Drive) and open it. Android will ask you to
   allow installing from that source — allow it. Or plug the phone in with USB debugging on
   and press the green **Run** button instead.

## Use it
1. On the computer, start Presenter (Presenter.bat / .app / presenter.sh) and click **📱 Phone**.
2. Phone on the same Wi-Fi. Either scan the QR code with the camera and choose
   **Presenter Remote**, or open the app and type the address (e.g. `192.168.1.23`).
3. Enter the PIN once. After that it just opens and connects.
- **Back button** on the remote = change computer/address.
- Scanning the QR only offers this app when Presenter uses the default port 8787; with another
  port, type the address into the app.
