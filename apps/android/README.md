# Android 앱

영어를 기본으로 하는 네이티브 앱이다. 첫 화면은 시작/종료 버튼 하나이며 두 AI의 음성은 같은 서버의 대화 맥락을 공유한다. 앱에는 OpenAI 키를 넣지 않는다.

## SDK 없이 가능한 검사

JDK 17 설치 후 프로젝트 루트에서 실행한다.

```powershell
.\scripts\android.ps1 -Task Check
```

공개 AOSP Android 15 클래스와 대조해 Java 소스를 컴파일하고 Robolectric·로컬 모의 HTTP/WebSocket 서버로 테스트한다. 음성 분절, 앞부분 보존, 긴 발화 상한, 끼어들기, 취소한 TTS의 늦은 도착, 연결 해제, 단일 버튼 화면, 권한 거부를 검사한다. 이 검사는 APK 패키징이나 실기기 검증을 대신하지 않는다.

## APK 만들기

1. 공식 Android SDK 이용약관에 동의하고 Command-line tools, `platform-tools`, `platforms;android-36`, `build-tools;35.0.0`을 설치한다.
2. `ANDROID_HOME`을 SDK 위치로 설정하거나 이 폴더의 Git 제외 `local.properties`에 `sdk.dir`을 설정한다.
3. 다음을 실행한다.

```powershell
.\scripts\android.ps1 -Task Debug
```

출력은 `apps/android/app/build/outputs/apk/debug/app-debug.apk`다. 코드의 앱 ID는 `com.jjome.tikitaka.dev`이며 Android 8 이상이 필요하다. 개발 빌드도 기본 대화는 영어다. 한국어 검증은 `-Language ko`로 빌드한다.

## 로컬 PC 서버와 연결

PC에서 실제 API 서버 8103을 실행하고 USB 디버깅을 허용한 기기를 연결한다. 기기의 첫 연결 신뢰 확인은 사용자가 직접 처리한다.

```powershell
adb reverse tcp:8103 tcp:8103
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

앱은 `http://127.0.0.1:8103`으로 접근한다. 서버는 PC의 loopback에서만 듣고 있으므로 임의로 LAN에 공개할 필요가 없다. 에뮬레이터에서도 `adb reverse`를 사용한다. 시작 버튼을 누르면 OS 마이크 권한을 요청하며 승인 후 대화를 시작한다. 앱을 벗어나거나 오디오 포커스를 잃으면 입력·재생·진행 중 요청을 멈춘다.

## 출시 빌드

```powershell
.\scripts\android.ps1 -Task Release -ServerUrl https://YOUR_DEPLOYED_HOST
```

release는 HTTPS 운영 주소가 없으면 실패하며 cleartext HTTP를 허용하지 않는다. 실제 운영 인증·비용 제한과 HTTPS 서버, 서명 설정, Play 계정·개인정보 처리방침, 실기기 에코·이어폰/Bluetooth 시험이 준비되어야 배포할 수 있다. 기본 설정의 AAB는 서명되지 않았으며 스토어 업로드 완료를 뜻하지 않는다. 서명 키를 저장소에 넣지 않는다.

## 구조

- `MainActivity`: 단일 버튼, 현재 화자·자막, OS 권한과 화면 생명주기.
- `ConversationClient`: 세션 HTTP/WebSocket, 한 번의 사용자 발화 처리, API 요청 취소, 이전 실행 결과 무시.
- `NativeAudio`: 24kHz mono AudioRecord, 기기 AEC/소음 억제, MediaPlayer 출력, 오디오 포커스·입력 종료.
- `PcmTurns`: Android와 분리된 PCM 분절 및 WAV 생성. 원본 사용자 음성을 파일로 저장하지 않는다.

실물 스피커 에코·Bluetooth 라우팅은 기기별 차이가 있어 자동 검사 통과와 구분한다. 현재 구조는 전사→GPT→음성 합성 방식이며 Realtime 스트리밍은 아니다.
