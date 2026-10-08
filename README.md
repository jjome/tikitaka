# Tikitaka

두 AI 친구와 자연스럽게 끼어들며 대화하는 영어회화 앱.

**가장 중요한 원칙은 심플함이다. 앱을 열고 “대화 시작” 버튼 한 번으로 바로 시작한다.** 주제와 두 AI 친구는 자동 준비하고 설정이나 진단 도구는 기본 화면에 넣지 않는다.

**출시 MVP는 영어 음성 대화 Android 앱이다.** 한국어는 내부 개발과 UX 검증에 사용한다. 마이크를 켜둔 상태에서 사용자가 말하면 AI 음성을 멈추고 사용자에게 발언권을 넘기는 동작을 첫 개발부터 포함한다. iPhone은 MVP 이후 지원한다.

## 문서

- [프로젝트 원문](doc/00_project_context.md): 최초 아이디어와 장기 비전. 현재 확정사항은 아래 스펙 우선.
- [제품 스펙](doc/01_spec.md): 최신 범위, 시나리오, 수용 기준.
- [설계](doc/02_architecture.md): 음성 상태 머신, 메시지와 이벤트, 모듈 경계.
- [테스트 계획](doc/03_test_plan.md): PC 자동 검사, 브라우저, Android 실기기 검사.
- [진행·출시 조건](doc/04_delivery.md): 실제 검사 결과와 남은 출시 조건.
- [Android 빌드](apps/android/README.md): 네이티브 앱 검사, APK 생성, 휴대폰 연결.

## 이번 개발 범위

Python 대화 엔진, PC 음성 클라이언트와 Android 네이티브 클라이언트를 구현했다. 실제 AI 모드는 OpenAI 전사·GPT 응답·음성 생성을 사용한다. Android는 영어로 시작하고 API 키는 서버에만 둔다. PC 검증과 APK 빌드, 실제 휴대폰 검증 및 스토어 출시는 각각 구분한다.

## PC에서 실행

Python 3.12 이상이 필요하다. Windows PowerShell에서 프로젝트 폴더를 연다.

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

[http://127.0.0.1:8100](http://127.0.0.1:8100)을 **Chrome**에서 열고 “대화 시작”을 누른다. 주제는 자동으로 선택된다. 처음 요청되는 브라우저 마이크 권한은 사용자가 허용한다. 이어폰을 쓰고 AI가 말하는 중 자연스럽게 끼어들어본다. 이후 발화마다 버튼을 누르지 않는다. 같은 버튼으로 대화를 끝낸다.

언어·주제 선택과 마이크 없는 텍스트 진단은 [개발 화면 /lab](http://127.0.0.1:8100/lab)에서 사용한다. 브라우저 음성 인식은 인터넷 연결과 지원 브라우저가 필요할 수 있다. PC 음성 어댑터는 출시용 Android 음성 경로가 아니다.

### 음성 인식 연결 오류

대본 데모의 브라우저 음성 인식은 내장 미리보기에서 `network` 오류가 날 수 있다. 실제 AI 모드는 OpenAI 음성 API를 사용하므로 이 브라우저 인식 서비스에 의존하지 않는다. 데모 음성을 시험할 때는 별도 Google Chrome 창의 주소창에 `http://127.0.0.1:8100/`을 입력한다.

Chrome에서도 같은 오류가 나면 Chrome의 마이크 권한과 인터넷 연결을 확인한다. 브라우저 음성 인식 서비스 연결과 로컬 앱 서버 연결은 서로 다르다. 앱은 인식 시작 이벤트를 확인한 뒤 AI 대화를 시작하며, 시작 실패 시 마이크를 반환한다. Android 출시에는 전용 음성 어댑터를 사용한다.

Chrome에서 입력이 없다면 주소창에 `http://127.0.0.1:8100/mic`을 입력해 개발용 마이크 점검을 연다. “마이크 확인 시작”을 누르고 말한 뒤, 입력이 없으면 실제 사용하는 마이크를 선택한다. 선택은 같은 브라우저에 저장되며 “대화 화면으로 돌아가기” 후에도 적용된다. 출시 Android 시작 화면에 마이크 선택 절차를 추가하는 기능은 아니다.

마이크 점검에서 선택한 장치 이름은 같은 호스트의 포트가 바뀌어도 재사용한다. 예를 들어 8100에서 선택한 마이크를 8101에서 해당 주소의 장치 ID로 다시 찾아 연다. 저장한 장치가 없거나 같은 이름의 장치가 여러 개면 다른 입력으로 조용히 전환하지 않고 점검을 안내한다. 기존 버전에서 저장한 선택을 복구해야 하는 개발 PC에서는 Git에서 제외한 `apps/pc/microphone.local.json`에 `{"label":"장치의 정확한 이름"}`을 둘 수 있다. 이 설정은 로컬 주소에서만 읽으며, 점검 화면에서 새로 선택한 장치가 우선한다. API 키나 음성 데이터는 이 파일에 넣지 않는다.

한국어가 내부 검증 기본값이다. 영어 UX는 `start.ps1 -Language en`으로 실행한다. 언어를 고르는 절차는 기본 시작 화면에 넣지 않는다.

## 실제 AI 연결

기본 `demo`는 **고정 대본**이며 유료 LLM을 호출하지 않는다. 실제 AI 대화에는 사용자의 API 키와 사용 가능한 모델 이름이 필요하다. 키는 현재 PowerShell 세션의 `OPENAI_API_KEY` 환경변수에 설정하고, 모델을 명시적으로 지정한다. `.env`는 자동으로 읽지 않는다.

API 키가 없다면 [OpenAI API 키 관리](https://platform.openai.com/api-keys)에서 개발용 키를 발급한다. 키를 채팅이나 코드에 붙여넣는 대신 아래 실행 도구의 비표시 입력란에 넣는다. 도구는 파일에 저장하지 않고 실행하는 서버 프로세스에 전달하며, 종료 시 이전 환경변수로 복원한다. 모델 ID는 계정에서 사용할 수 있는 이름을 지정한다.

```powershell
.\scripts\start-openai.ps1 -Model "YOUR_AVAILABLE_MODEL" -Check
.\scripts\start-openai.ps1 -Model "YOUR_AVAILABLE_MODEL" -Language ko -Port 8101
.\scripts\start-openai.ps1 -Model "YOUR_AVAILABLE_MODEL" -Language ko -Port 8101 -CheckAndStart
```

`-Check`는 실제 API에 최대 3회 요청해 민지 → 준호 → 민지 응답을 출력한다. 인사·감정에 맞게 응답하는지, 대화 주제가 바뀌어도 따라오는지, 앞서 말한 이름을 기억하는지 사람이 확인한다. 이 검사는 유료 호출이며 음성 품질 검사는 아니다. 실패 시 대본 데모로 대체하지 않는다. 두 번째 명령은 실제 AI 모드 서버를 실행한다. 실행 중인 데모 서버와 포트를 분리했으므로 Chrome에서 `http://127.0.0.1:8101/`을 열어야 한다.

`-CheckAndStart`는 키를 한 번 입력하면 검사 후 같은 키로 서버를 시작한다. 검사 결과는 Git에서 제외한 `.runtime/api-check.out.log`와 UTF-8 `.runtime/api-check.json`에 저장하고 키는 기록하지 않는다. JSON 결과는 Windows PowerShell 콘솔 인코딩과 관계없이 한국어를 보존한다. PowerShell 창을 닫으면 이 서버도 종료되므로 시험하는 동안 창을 유지한다.

```powershell
.\scripts\start.ps1 -Provider openai -Model "YOUR_AVAILABLE_MODEL" -Language en -Port 8101
```

실제 모델 모드는 호출 비용이 발생할 수 있다. 세션마다 실패와 취소를 포함해 최대 60회 호출하고 출력 토큰은 요청당 500으로 제한한다. 정확한 금액 상한은 아직 구현하지 않았으므로 Provider 측 예산 설정을 함께 사용한다. 키를 프런트엔드, 커밋, 채팅에 넣지 않는다.

실제 AI 모드는 선택한 마이크 → AudioWorklet PCM 수집 → 발화 종료 감지 → OpenAI 전사 → GPT 응답 → OpenAI 음성 생성·재생 구조다. 두 AI는 서로 다른 목소리를 사용하고, 사용자가 말하면 로컬에서 먼저 재생과 음성 다운로드를 취소한다. 소리가 끝난 뒤 약 1초 후 인식 요청을 보내므로 Realtime 음성 스트리밍과는 응답 지연이 다르다. Realtime 연결은 아직 구현하지 않았다.

음성 API까지 확인하고 서버를 실행하려면 다음을 사용한다. `-CheckAudio`는 고정된 합성 점검 문장으로 음성 생성·인식을 각 1회 호출하고 `.runtime/audio-check.json` 및 `.runtime/audio-check.wav`를 만든다. 사람의 마이크를 녹음하는 검사는 아니다. `-Reload`는 백엔드 코드 수정 시 키를 재입력하지 않고 개발 서버를 다시 불러온다.

```powershell
.\scripts\start-openai.ps1 -Model "YOUR_AVAILABLE_MODEL" -Port 8103 -CheckAudio -Reload
```

서버 `/api/health`의 `voice_transport`가 `api`인 것을 확인한다. 원시 마이크 음성은 로컬 서버 메모리에서만 처리하며 DB나 파일에 저장하지 않는다. 한 음성 조각은 최대 약 20초, 세션당 전사·음성 생성 요청은 각각 최대 60회다. 생성·전사 실패도 요청 수에 포함된다. 모델 기본값은 `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`이며 서버 환경변수 `TIKITAKA_TRANSCRIPTION_MODEL`, `TIKITAKA_SPEECH_MODEL`로 지정할 수 있다.

`/assets/audio-test.html`은 개발용 음성 연결 점검 화면이다. 위 합성 WAV를 선택하면 브라우저의 실제 오디오 처리 경로에 파일을 흘려보내 첫 AI 음성에 끼어들고, 인식한 문장을 GPT에 보내 준호·민지 답변의 재생까지 시험한다. 실제 API를 사용하고 AI 응답 3개 후 자동 종료한다. 합성 입력 검사와 실제 마이크·스피커 검사는 구분한다.

## 자동 검사

```powershell
.\scripts\test.ps1
```

Python `unittest`로 상태 머신, 취소, 저장, HTTP/WebSocket과 Provider 계약을 검사한다. Node 기본 테스트 러너로 전사 모으기, 활동 감지, 오래된 음성 콜백을 검사한다. 실제 마이크와 유료 API를 사용하지 않는다.

데모 서버가 실행 중이면 아래 명령으로 기본 화면의 실제 대화 제어 코드와 로컬 HTTP/WebSocket 서버를 함께 검사한다. 마이크·인식·재생·DOM만 모의 구현하고, 끼어들기 → 중간 전사 → 최종 전사 → 지목한 준호 응답 → 민지·준호 교대까지 확인한다. 실제 마이크 인식 성공을 대신하는 검사는 아니다.

```powershell
node tests/live-conversation.mjs
node tests/live-conversation.mjs --interim-only
```

실제 API 서버가 8101에서 실행 중일 때 `node tests/live-conversation.mjs --openai`로 기본 화면의 실제 제어 코드와 서버를 연결해 검사한다. 명시적인 `--openai` 옵션이 필요하며 최대 3개 AI 응답을 생성하는 유료 검사다. 사용자 끼어들기와 준호 응답 후 민지의 다음 발화를 확인한다. 마이크·STT·TTS·DOM은 모의 구현이므로 실제 음성 품질 검사는 별도로 진행한다.

`--interim-only`는 브라우저가 최종 전사를 반환하지 않는 조건에서 사용자 발화 두 번과 AI 응답이 이어지는지 검사한다. 이 경우 앱은 발화 종료 후 마지막 인식 문장을 채택한다. 브라우저의 최종 전사보다 정확도가 낮을 수 있으나 시작 버튼을 다시 누르지 않고 대화를 계속한다.

## 폴더 구조

```text
apps/pc/        PC 음성 테스트 UI와 브라우저 음성 어댑터
apps/android/   Android 네이티브 앱, Gradle 빌드와 JVM 검사
backend/app/    대화 엔진, Persona와 Topic, Gateway, API, 저장소
doc/            현재 스펙, 설계, 테스트 계획
scripts/        설치, 실행, 테스트 PowerShell 스크립트
tests/          Python 및 JavaScript 테스트
.runtime/       로컬 세션 DB (Git 제외)
```

## 개발 제한과 다음 단계

- 마이크 권한, 실제 음성 인식, 스피커 에코와 응답 지연은 사람이 직접 말하며 확인해야 한다.
- 대본 데모에서는 브라우저 STT와 활동 감지 캡처가 같다는 보장이 없다. 실제 API 모드는 같은 PCM 입력을 사용한다. 에너지 감지만으로 소음과 말소리를 완전히 구분하지 못한다.
- 말해도 마이크 표시가 움직이지 않으면 Chrome에서 페이지를 강력 새로고침(Ctrl+Shift+R)하고 다시 시작한다. 계속 입력이 없으면 `chrome://settings/content/microphone`에서 실제 사용하는 마이크가 선택돼 있는지 확인한다. 브라우저 STT 지원과 실제 마이크 신호 수신은 각각 확인해야 한다.
- 대본 데모는 PC에 설치된 TTS 음성을 사용한다. 실제 API 모드는 두 친구에 서로 다른 OpenAI 목소리를 사용한다.
- SQLite와 단일 서버는 내부 로컬 개발 범위다. 공개 배포 전 사용자 접근 제어, HTTPS, 비용 상한, DB와 세션 조정, 보관 정책이 필요하다.
- 한국어·영어 합성 입력으로 실제 API 전체 경로를 확인했다. Android 실기기의 입력·에코·Bluetooth 및 영어 대화 품질 검증은 별도로 필요하다.

