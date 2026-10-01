> 원문 v0.1 보존본입니다. 현재 개발에서는 01_spec.md의 영어 음성 Android MVP 및 한국어 내부 검증 로드맵을 우선합니다.

# AI 3자 영어회화 앱 — Project Context v0.1

## 1. 프로젝트 목적

한국인을 위한 AI 영어회화 앱을 개발한다.

핵심 목표는 단순히 영어를 가르치는 것이 아니라,

> "영어를 공부하기 위해 대화하는 것이 아니라,
> 대화가 재미있어서 참여하다 보니 영어를 계속 사용하게 되는 경험"

을 만드는 것이다.

초기 개발에서는 영어를 바로 사용하지 않는다.

먼저 한국어로 대화 시스템 자체를 개발하여
"이 대화 방식이 실제로 재미있는가?"를 검증한다.

한국어 → 영어 학습 앱으로 사용자를 전환시키는 서비스가 아니다.

한국어는 개발 및 UX 검증을 위한 단계이며,
최종 제품의 핵심 목적은 한국인의 영어회화 학습이다.


# 2. 핵심 문제

일반적인 AI 영어회화는 대부분 다음 구조다.

AI 질문
↓
User 대답
↓
AI 질문
↓
User 대답

이 구조에서는 사용자가 계속 대화를 만들어야 한다.

영어 초중급 사용자에게는 동시에 다음 부담이 생긴다.

1. 영어로 어떻게 말할지 생각해야 한다.
2. 무엇을 말할지도 생각해야 한다.
3. 사용자가 말하지 않으면 대화가 멈춘다.

결과적으로 대화가 아니라 계속 답해야 하는 과제가 되기 쉽다.


# 3. 핵심 제품 아이디어 — 3자 대화

기존:

User ↔ AI

본 서비스:

        User
       ↙    ↘
    AI A ↔ AI B

AI A와 AI B는 서로 독립적인 Persona를 가진다.

중요한 점은 사용자가 말하지 않아도
AI A와 AI B가 서로 대화를 계속할 수 있다는 것이다.

사용자는:

Listen
↓
Interest
↓
Join
↓
Conversation
↓
Leave
↓
Listen / Return

형태로 자유롭게 참여한다.

사용자가 항상 대화의 진행자일 필요가 없다.


# 4. 핵심 UX 가설

이 프로젝트에서 가장 먼저 검증해야 할 질문은:

> "AI 두 명이 이야기하는 것을 듣다가
> 사용자가 자발적으로 끼어드는 경험이 재미있는가?"

이다.

예:

A: 짜장면이 무조건 낫지.
B: 짜장은 세 입 먹으면 질리잖아.
A: 그건 네가 짜장을 못 먹는 거야.

User:
"아닌데? 난 짜장이 훨씬 좋은데?"

그러면 A와 B가 사용자의 의견을 받아
다시 3자 대화를 이어간다.

핵심은 AI가 사용자를 계속 질문으로 호출하는 것이 아니다.

사용자에게

"아니, 그건 아닌데?"
"나도 할 말 있는데?"

라는 감정을 만들어 자발적으로 참여하게 하는 것이다.

이를 임시로 Join Moment라고 정의한다.


# 5. Product Philosophy

Conversation First.
Learning Second.

사용자가 앱을 실행하는 첫 번째 이유는
"영어 공부"만이 아니라

"저 친구들과 이야기하는 것이 재미있기 때문"

이어야 한다.

영어 학습은 재미있는 대화 위에 올라가는 별도의 Layer다.


# 6. AI Persona 구조

AI A와 AI B는 단순히 다른 System Prompt를 가진 chatbot이 아니다.

Persona를 데이터 구조로 분리한다.

Persona
├── Identity
├── Personality
├── Conversation Style
├── Speaking Style
├── Interests
├── Preferences
├── Relationship
└── Memory

예시 Personality parameter:

- extroversion
- humor
- empathy
- curiosity
- initiative
- argumentative
- directness
- emotional_expression
- question_frequency
- response_length

Persona와 LLM Provider는 반드시 분리한다.


# 7. AI A / AI B의 기본 역할

초기 기본 조합:

## AI A — Facilitator

- 대화를 안정적으로 이어감
- 사용자의 말을 잘 받아줌
- 사용자를 소외시키지 않음
- 이해하기 쉬운 표현 사용
- 대화가 끊어졌을 때 복구
- 필요할 때 자연스럽게 사용자를 참여시킴

## AI B — Challenger

- 자기 의견이 비교적 강함
- 반박
- 농담
- 예상하지 못한 질문
- A와 의견 충돌
- 대화에 긴장과 재미를 만듦

Teacher A + Teacher B 구조로 만들지 않는다.

기본 철학은:

Friend A + Friend B + Invisible Teacher

이다.


# 8. MBTI

한국 사용자에게 친숙한 Character Selection UI로 MBTI를 사용할 수 있다.

예:

ENFP 민지
- 말 많음
- 즉흥적
- 장난 많음

INTJ 준호
- 논리적
- 직설적
- 반박을 좋아함

사용자는:

ENFP + INTJ

같은 두 캐릭터 조합을 선택할 수 있다.

그러나 내부 로직에서 MBTI 문자열 자체에 의존하면 안 된다.

예:

MBTI = ENFP

→

extroversion = 0.9
humor = 0.8
initiative = 0.9
argumentative = 0.4
empathy = 0.8

처럼 실제 Persona parameter로 변환한다.

향후 MBTI가 아닌 다른 Persona 시스템도 사용할 수 있어야 한다.


# 9. Relationship

Persona 자체의 특성과 관계 특성을 분리한다.

예:

User ↔ A = 오래된 친구
User ↔ B = 최근 알게 된 친구
A ↔ B = 친하지만 자주 논쟁하는 관계

같은 Persona라도 Relationship에 따라
대화 방식이 달라질 수 있도록 설계한다.


# 10. Topic System

초기에는 정답이 없고,
사람이 자연스럽게 자기 의견을 말하고 싶어지는 주제를 사용한다.

예:

- 짜장 vs 짬뽕
- 부먹 vs 찍먹
- 여름 vs 겨울
- 계획 여행 vs 즉흥 여행
- 집에서 놀기 vs 밖에서 놀기
- 연애에서 연락은 얼마나 자주 해야 하나

초기에는 정치처럼 지나치게 감정 소모가 큰 주제보다
가볍지만 의견이 갈리는 주제를 우선한다.

향후:

User Interests
+
Persona Interests
+
Conversation History

를 이용하여 Topic을 개인화한다.


# 11. Conversation Orchestrator

제품의 핵심 컴포넌트다.

LLM에게 모든 대화 진행을 맡기지 않는다.

Conversation Orchestrator가 최소한 다음을 관리한다.

- 다음에 누가 말할 것인가?
- A와 B가 몇 번 연속 대화할 것인가?
- 사용자를 언제 자연스럽게 포함할 것인가?
- 사용자가 끼어들면 누구부터 반응할 것인가?
- 발화 길이는 어느 정도인가?
- 대화가 정체되면 어떻게 복구할 것인가?
- Topic을 언제 전환할 것인가?
- AI끼리 의견 차이를 얼마나 만들 것인가?
- 대화를 언제 종료/휴식시킬 것인가?

장기적으로 이 Orchestration 자체가
제품의 중요한 기술적 자산이 될 가능성이 있다.


# 12. LLM Architecture

특정 LLM에 종속시키지 않는다.

Conversation Orchestrator
        │
    ┌───┴───┐
    ↓       ↓
Persona A Persona B
    │       │
    ↓       ↓
LLM Gateway
    │
    ├── Provider A
    ├── Provider B
    └── Future Provider

설정에 따라:

A = Model X
B = Model X

또는

A = Model X
B = Model Y

모두 가능해야 한다.

초기 버전에서는:

동일 LLM + 서로 다른 Persona

로 시작한다.

Multi-model은 실제 필요성이 확인된 이후 실험한다.


# 13. Learning Layer

Conversation Engine과 영어 학습 기능을 분리한다.

사용자가 영어로:

"I very like this food."

라고 말했을 때 대화 중 계속

"문법이 틀렸습니다."

라고 끊으면 안 된다.

AI 친구들은 우선 자연스럽게 대화를 이어간다.

별도의 Learning Analyzer가 대화를 관찰한다.

Conversation
     │
     ├── AI A
     ├── AI B
     └── User
          │
          ↓
   Learning Analyzer

분석 대상:

- grammar
- unnatural expression
- vocabulary
- repeated mistakes
- better expressions
- expressions learned
- fluency tendency
- long-term improvement

대화 이후:

"I very like this food."
→
"I really like this food."

처럼 피드백할 수 있다.

핵심:

Conversation Mode ≠ Learning Mode


# 14. Voice

Text UX 검증 후 Voice를 추가한다.

기본 구조:

User Voice
↓
STT
↓
Conversation Engine
↓
LLM
↓
TTS
↓
AI Voice

장기적으로 일반적인 push-to-talk 방식이 아니라
실제 사람 세 명이 이야기하는 느낌을 목표로 한다.

필요 기술:

- Streaming STT
- Streaming LLM
- Streaming TTS
- Voice Activity Detection
- Turn Taking
- Barge-in / Interruption
- Latency Control

예:

AI A:
"Actually, I think—"

User:
"No, wait."

→ AI A 음성을 즉시 중단
→ 사용자 발화를 인식
→ A/B가 자연스럽게 반응

하지만 이 기능은 초기 MVP에 넣지 않는다.


# 15. Memory

모든 대화 원문을 Persona 자체에 계속 넣는 구조는 피한다.

대화 기록과 Persona Memory를 분리한다.

Conversation History
↓
Memory Analyzer
↓
Important Information Extraction
↓
Structured Memory

예:

- 사용자가 축구를 좋아함
- 매운 음식을 좋아함
- 농담에 잘 반응함
- 짧은 답변을 선호함

등의 특징을 별도로 추출한다.

향후 Forget/Edit/Permission 구조도 고려한다.


# 16. 장기 Personal Persona

장기적으로 사용자의 대화 데이터를 이용하여
사용자 자신의 Persona Profile을 만들 수 있다.

예:

My Persona
├── Speaking Style
├── Interests
├── Preferences
├── Personality
├── Humor
├── Conversation Habits
└── Shared Memories

단, 실제 인간 자체를 복제한다고 정의하지 않는다.

"사용자가 공유하도록 허용한 대화 특성을
AI가 표현하는 Persona"

라는 개념으로 설계한다.


# 17. Friend Persona / Social 확장

장기적으로 사용자가 자신의 Persona를
친구에게 공유할 수 있도록 한다.

예:

User
+
Friend Persona
+
AI Friend

형태의 3자 대화가 가능하다.

향후 전화번호/SNS 등의 Social Graph와 연결될 가능성도 고려한다.

중요한 원칙:

AI가 실제 친구 본인인 것처럼 가장하면 안 된다.

명확하게:

"친구가 공유한 Persona를 기반으로 AI가 생성한 발화"

라는 구조여야 한다.

필요 요소:

- explicit consent
- sharing scope
- memory permissions
- revoke
- delete
- AI-generated indication


# 18. 초기 기술 구조

Android App
     │
     ↓
Backend API
     │
     ├── Authentication
     ├── Conversation Service
     ├── Persona Service
     ├── Topic Service
     ├── Memory Service
     └── Learning Service
              │
              ↓
     Conversation Orchestrator
              │
              ↓
          LLM Gateway
              │
      ┌───────┼───────┐
      ↓       ↓       ↓
 Provider A Provider B ...

Database
├── User
├── Persona
├── Relationship
├── Conversation
├── Message
├── Memory
└── Learning Profile

초기 Android 후보:

Kotlin + Jetpack Compose

Backend 후보:

FastAPI 등

DB 후보:

PostgreSQL

구체적인 기술은 구현 전 다시 검토할 수 있다.

핵심 원칙은:

Persona
Conversation
LLM
Learning
Voice

레이어를 강하게 결합하지 않는 것이다.


# 19. 개발 Roadmap

## Phase 1 — Korean Text Conversation

가장 먼저 구현.

목표:

"3자 대화 자체가 재미있는가?"

기능:

- User
- AI A
- AI B
- Text conversation
- Basic Persona
- Topic selection
- Turn management
- User join
- AI-to-AI conversation

영어 교육 기능 없음.


## Phase 2 — Persona Engine

- Persona parameter
- MBTI UI
- Interests
- Speaking Style
- Relationship
- Character selection


## Phase 3 — English Text Conversation

Conversation Engine은 유지하고
대화 언어를 영어로 확장한다.

이 단계에서는 교정보다
자연스럽게 대화가 지속되는 것을 우선한다.


## Phase 4 — Learning Analyzer

- grammar correction
- natural expression
- vocabulary
- session review
- recurring mistake analysis


## Phase 5 — Voice

- STT
- TTS
- AI character voices


## Phase 6 — Real-time Voice

- streaming
- interruption
- natural turn-taking
- latency optimization


## Phase 7 — Personal Memory / Persona

사용자의 실제 대화에서
장기적인 성향과 관심사를 추출한다.


## Phase 8 — Social / Friend Persona

- Persona sharing
- friends
- permissions
- social conversation


# 20. MVP에서 하지 않을 것

초기 MVP에는 다음을 넣지 않는다.

- SNS
- 연락처 연동
- Friend Persona
- 복잡한 Long-term Memory
- Multi-LLM optimization
- 정교한 발음 평가
- Full-duplex Voice
- 복잡한 Gamification
- 구체적인 수익화 시스템

Scope creep를 적극적으로 막는다.


# 21. 초기 성공 지표

가장 중요한 행동은:

AI conversation
↓
User Interest
↓
User voluntarily joins

이다.

이를 Join Moment라고 정의한다.

초기 측정 후보:

- Time to First Join
- Session Duration
- User Utterances per Session
- User / AI Turn Ratio
- Topic Change Rate
- Persona Combination Selection
- Session Completion
- Return Rate

영어 버전 이후 학습 관련 지표를 추가한다.


# 22. 초기 마케팅 방향

초기 메시지를:

"새로운 AI 영어 선생님"

으로 잡지 않는다.

차별화 메시지는:

> "AI 친구 둘이 먼저 떠든다.
> 듣다가 할 말이 생기면 끼어들면 된다."

에 가깝다.

Short-form Content와 잘 결합할 수 있다.

예:

ENFP vs INTJ
"짜장 vs 짬뽕"

두 AI가 논쟁하는 짧은 장면 자체가
제품 데모이면서 콘텐츠가 될 수 있다.

초기 타깃은:

"영어를 배우고 싶지만 기존 영어 공부나
1:1 영어회화를 오래 지속하지 못한 한국 사용자"

를 우선 고려한다.


# 23. Business Model

현재 단계에서는 구체적인 가격이나 과금제를 확정하지 않는다.

큰 방향으로는:

Freemium
+
Subscription

가능성을 고려하지만,
Conversation UX가 검증된 이후 결정한다.

지금 단계에서는 수익 최적화보다
Product-Market Fit의 초기 가설 검증이 우선이다.


# 24. Product Vision

표면적으로는 AI 영어회화 앱이지만,
장기적으로 만드는 핵심 기술은:

> Multi-Persona Social Conversation System

이다.

영어 학습은 이 시스템의 첫 번째 Use Case다.

장기 확장:

AI Friend
↓
Personalized AI Friend
↓
My Persona
↓
Friend Persona
↓
Persona Network


# 25. North Star

우리가 궁극적으로 만들고 싶은 경험은:

"오늘 영어 공부했어?"

가 아니라

"오늘 걔들이랑 무슨 얘기했어?"

이다.

사용자가 AI를 학습 도구가 아니라
다시 만나고 싶은 대화 상대로 느끼고,

그 관계와 대화 속에서 자연스럽게 영어를
반복적으로 듣고 말하게 만드는 것이 목표다.


# 26. 지금 Codex가 집중해야 할 범위

아직 전체 앱을 구현하지 않는다.

우선 Phase 1만 대상으로 한다.

Korean Text Conversation Prototype:

User + AI A + AI B

가 서로 대화할 수 있는 최소 시스템을 설계한다.

첫 구현의 목적은 기능의 양이 아니라
3자 대화 UX를 검증하는 것이다.

구현 전에 먼저 다음을 작성한다.

1. Phase 1 PRD
2. 최소 기능 목록
3. 화면/사용자 Flow
4. Conversation State Machine
5. Persona A/B 데이터 구조
6. Conversation Orchestrator 설계
7. LLM Gateway interface
8. Message/Conversation DB schema
9. 프로젝트 디렉터리 구조
10. 구현 순서

중요:

아직 코드를 대량으로 작성하지 말 것.

먼저 위 설계를 제안하고,
각 결정의 이유와 MVP에서 제외할 항목을 명확히 한 뒤
구현 단계로 넘어갈 것.