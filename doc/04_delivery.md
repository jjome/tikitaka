# Android MVP 구현 현황

2026-10-09. 사용자는 영어 Android MVP 완성을 요청했고 자리를 비운 동안 개발·검사·커밋·푸시를 허용했다. 실물 마이크는 사용하지 않고 합성 음성으로 시험한다.

## 현재 확인된 결과

- 8103 실제 API 서버에서 합성 TTS→STT 통과.
- Codex 내장 브라우저에서 한국어·영어 각각 실제 AudioWorklet 입력 → OpenAI 전사 → GPT 응답 → OpenAI TTS 재생 통과. 첫 민지 발화 중단 후 준호·민지 재생 완료. 두 결과 모두 provider=openai, speakers=a,b,a, played=b,a, interruptions=1. 중단된 음성은 재개되지 않았다.
- 영어 합성 입력은 “Junho, I prefer winter. Summer is too hot.”으로 정확히 전사되었다.
- Python 55개, JavaScript 45개 검사 통과. Android 소스 컴파일 및 JVM 검사 12개 통과(음성 분절, HTTP/WebSocket 제어, 취소·늦은 응답, 권한·단일 버튼 화면). 물리 마이크, 스피커 에코와 Android 기기는 아직 검증하지 않았다.
- GitHub Actions가 사전 설치된 SDK로 Android 테스트·lint·APK 빌드를 실행하도록 구성했다. 빌드 결과는 확인 후 기록한다.
- 최초 APK 컴파일·테스트는 통과했으나 lint에서 개발용 네트워크 설정의 속성 누락을 발견해 수정했다. 권한 승인 시점에 따른 시작 누락도 회귀 검사로 막았다.
- 세션 7일 보관, 소유 토큰으로 즉시 삭제, 삭제 시 처리 중 음성 요청 취소, 사용하지 않는 대화 컨트롤러의 메모리 해제를 구현했다.

## 이번 구현 순서

1. 실제 API 검증 결과 보존, PC 기본 화면과 영어 경로 안정화.
2. Android 네이티브 클라이언트: 단일 버튼, 기본 영어, 고정 두 친구, AudioRecord 입력, 로컬 끼어들기, API 전사·음성 재생, 앱 중단·오디오 포커스 손실 시 자원 반환.
3. Android 제어·음성 분절의 자동 검사와 빌드 검증. API 키는 앱에 넣지 않는다. 개발은 USB 포트 역방향 전달로 로컬 서버와 연결한다.
4. 서버 배포 준비와 보관·삭제 정책, 실행/검사 안내, 남은 출시 조건 정리.

## 출시 완료 조건

실기기에서 권한·유선/Bluetooth 경로·스피커 에코·끼어들기·백그라운드 전환을 확인하고, 운영 HTTPS 서버와 사용자 접근 제어·비용 상한, 서명 키, Google Play 계정 및 스토어 정보를 준비해야 한다. APK 컴파일과 스토어 출시를 구분한다. 준비되지 않은 계정이나 배포 주소를 임의로 만들지 않는다.

## Android 선택

Java 17 + Android Gradle Plugin 8.13.2, 최소 Android 8(API 26), compile/target API 36. 네이티브 AudioRecord/MediaPlayer와 OkHttp로 기존 세션 계약을 사용한다. WebView의 브라우저 음성 인식에 의존하지 않는다. release 서버 주소는 빌드 설정으로 HTTPS를 지정하며 debug는 localhost:8103 및 adb reverse를 사용한다. 한국어 검증은 빌드 언어 설정으로만 전환한다.
