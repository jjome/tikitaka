"""Versioned character data independent of models and audio providers."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    id: str
    name: str
    name_en: str
    role: str
    style: str
    parameters: dict[str, float]


PERSONAS = {
    'a': Persona('a', '민지', 'Minji', 'Facilitator',
                 'Warm, curious friend. Acknowledge opinions without asking the user to lead.',
                 {'empathy': .9, 'humor': .55, 'argumentative': .3, 'initiative': .65}),
    'b': Persona('b', '준호', 'Junho', 'Challenger',
                 'Playful friend with a different opinion. Tease ideas, never insult people.',
                 {'empathy': .65, 'humor': .75, 'argumentative': .75, 'initiative': .8}),
}

TOPICS = {
    'food': {'ko': '짜장 vs 짬뽕', 'en': 'Comfort food or spicy food?',
             'a': 'Familiar comforting flavors', 'b': 'Spicy food and trying something new',
             'ko_lines': ['짜장은 첫 입부터 마음이 편해져. 메뉴 고민할 때는 익숙한 맛이 최고지.',
                          '난 짬뽕. 메뉴판 앞에서까지 안전한 선택만 하면 좀 아쉽잖아.',
                          '매번 모험하다가 실패하면 배고픈데 기분까지 상하지 않아?',
                          '실패한 메뉴도 나중엔 얘깃거리가 되지. 짜장은 기억에 안 남잖아.'],
             'en_lines': ['I like familiar food. A warm bowl of noodles can make a bad day better.',
                          'I want something spicy. A little surprise makes dinner more fun.',
                          'But what if the surprise is just a really bad meal?',
                          'Then at least we have a funny story. Safe choices can be boring.']},
    'sauce': {'ko': '부먹 vs 찍먹', 'en': 'Pour the sauce or dip?',
              'a': 'Pour the sauce for convenience', 'b': 'Dip for crispy texture',
              'ko_lines': ['난 소스를 부어 먹는 쪽이야. 소스가 고르게 묻어야 맛있지.',
                           '그러면 바삭함이 사라지잖아. 찍어 먹어야 끝까지 맛있어.',
                           '한 입마다 찍는 게 좀 번거롭지 않아? 배고플 땐 빨리 먹고 싶어.',
                           '그 몇 초 때문에 바삭함을 포기할 수는 없지. 난 끝까지 찍먹이야.'],
              'en_lines': ['I pour the sauce. I want the same flavor in every bite.',
                           'I dip. Crispy food should stay crispy.',
                           'That sounds like a lot of work when you are hungry.',
                           'Good food is worth a few extra seconds.']},
    'season': {'ko': '여름 vs 겨울', 'en': 'Summer or winter?',
               'a': 'Warm summer evenings', 'b': 'Cozy winter days',
               'ko_lines': ['여름은 해가 길어서 좋아. 저녁 먹고 산책해도 아직 밝잖아.',
                            '난 겨울. 이불 밖에 안 나가도 그럴듯한 이유가 생기거든.',
                            '그건 겨울이 좋은 게 아니라 집이 좋은 거 아냐?',
                            '따뜻한 집을 더 좋게 만들어주는 계절이라니까.'],
               'en_lines': ['I love summer evenings. There is still light after dinner.',
                            'I prefer winter. Staying home feels like the right choice.',
                            'Do you love winter, or do you just love your sofa?',
                            'Winter makes my sofa even better. That is my point.']},
    'travel': {'ko': '계획 여행 vs 즉흥 여행', 'en': 'Planned or spontaneous travel?',
               'a': 'Plan the essentials', 'b': 'Leave room for surprises',
               'ko_lines': ['여행은 예약이 되어 있어야 편해. 숙소 찾느라 하루를 쓰고 싶진 않아.',
                            '계획이 너무 많으면 여행이 출근처럼 느껴져. 난 빈 시간이 좋아.',
                            '그럼 맛집 앞에서 두 시간 기다리는 것도 여행의 일부야?',
                            '옆집에서 더 맛있는 걸 발견할 수도 있지. 계획표엔 그런 일이 없잖아.'],
               'en_lines': ['I book the important things first. I want to enjoy the trip, not find a hotel.',
                            'Too many plans make a trip feel like work. I like free time.',
                            'Would you enjoy waiting two hours for lunch?',
                            'I would try the place next door. That could be the best part.']},
    'weekend': {'ko': '집에서 쉬기 vs 밖에서 놀기', 'en': 'Stay home or go out?',
                'a': 'A quiet weekend at home', 'b': 'Get out and explore',
                'ko_lines': ['주말엔 집에서 쉬고 싶어. 아무 약속 없는 날이 제일 귀하더라.',
                             '난 밖에 나가야 주말 같아. 집에만 있으면 월요일이 너무 빨리 와.',
                             '밖에서 놀다 지치면 월요일이 더 힘들지 않아?',
                             '그래도 주말에 뭘 했는지 기억은 나잖아. 낮잠은 기억이 없어.'],
                'en_lines': ['A quiet weekend at home sounds perfect to me.',
                             'I need to go out. Otherwise the weekend disappears.',
                             'But do you really want to feel tired on Monday?',
                             'At least I have something to talk about on Monday.']},
}

