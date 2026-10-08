package com.jjome.tikitaka;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

/** One button enters/leaves the conversation. No setup choices in the product flow. */
public final class MainActivity extends Activity implements ConversationClient.View {
    private static final int MICROPHONE_PERMISSION = 10;
    private final int ink = Color.rgb(36, 70, 60), paper = Color.rgb(246, 247, 243);
    private ConversationClient conversation;
    private Button talk;
    private TextView status, caption, speaker, error;
    private ProgressBar level;
    private Friends friends;
    private boolean resumed;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(paper);
        root.setPadding(dp(24), dp(16), dp(24), dp(16));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(dp(24) + insets.getSystemWindowInsetLeft(), dp(16) + insets.getSystemWindowInsetTop(),
                dp(24) + insets.getSystemWindowInsetRight(), dp(16) + insets.getSystemWindowInsetBottom()); return insets;
        });
        TextView brand = text("tikitaka.", 24); brand.setTypeface(null, Typeface.BOLD); root.addView(brand);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout center = new LinearLayout(this); center.setOrientation(LinearLayout.VERTICAL); center.setGravity(Gravity.CENTER);
        center.setPadding(0, dp(24), 0, dp(24)); scroll.addView(center);
        TextView title = text("말하고 싶을 때,\n그냥 시작하세요.", 29); title.setGravity(Gravity.CENTER); title.setTypeface(null, Typeface.BOLD);
        title.setLineSpacing(dp(5), 1); center.addView(title);
        TextView subtitle = text("두 AI 친구와, 편하게 나누는 영어 대화.", 14); subtitle.setGravity(Gravity.CENTER);
        add(center, subtitle, 14);
        friends = new Friends(); friends.setContentDescription("민지와 준호, 두 AI 친구");
        center.addView(friends, new LinearLayout.LayoutParams(-1, dp(154)));
        speaker = text("", 13); speaker.setGravity(Gravity.CENTER); add(center, speaker, 8);
        caption = text("친구들이 먼저 이야기할게요.\n할 말이 생기면 언제든 끼어들어요.", 17);
        caption.setGravity(Gravity.CENTER); caption.setMinHeight(dp(90)); caption.setLineSpacing(dp(5), 1); add(center, caption, 8);
        level = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); level.setMax(100);
        level.setProgressTintList(android.content.res.ColorStateList.valueOf(ink));
        LinearLayout.LayoutParams meter = new LinearLayout.LayoutParams(dp(58), dp(3)); meter.gravity = Gravity.CENTER; meter.topMargin = dp(12);
        center.addView(level, meter); level.setContentDescription("마이크 입력 크기");
        error = text("", 13); error.setTextColor(Color.rgb(161, 69, 40)); error.setGravity(Gravity.CENTER); error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        add(center, error, 12); error.setVisibility(View.GONE);
        talk = new Button(this); talk.setText("대화 시작"); talk.setTextSize(17); talk.setTextColor(Color.WHITE); talk.setAllCaps(false);
        GradientDrawable background = new GradientDrawable(); background.setColor(ink); background.setCornerRadius(dp(20)); talk.setBackground(background);
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-1, dp(60)); button.topMargin = dp(20); center.addView(talk, button);
        status = text("버튼 한 번으로, 바로 대화해요.", 12); status.setGravity(Gravity.CENTER); add(center, status, 12);
        TextView disclosure = text("AI 생성 음성 · 대화 중 마이크 사용", 11); disclosure.setGravity(Gravity.CENTER); root.addView(disclosure);
        setContentView(root);
        conversation = new ConversationClient(this, this, BuildConfig.SERVER_URL, BuildConfig.CONVERSATION_LANGUAGE);
        talk.setOnClickListener(v -> {
            if (conversation.isActive()) { conversation.stop(); return; }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_PERMISSION);
            } else conversation.start();
        });
    }
    private TextView text(String value, int size) {
        TextView node = new TextView(this); node.setText(value); node.setTextSize(size); node.setTextColor(ink); return node;
    }
    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(top); parent.addView(child, params);
    }
    private int dp(float size) { return Math.round(size * getResources().getDisplayMetrics().density); }
    @Override protected void onResume() { super.onResume(); resumed = true; }
    @Override protected void onPause() { resumed = false; if (conversation != null) conversation.stop(); super.onPause(); }
    @Override protected void onDestroy() { if (conversation != null) conversation.dispose(); super.onDestroy(); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != MICROPHONE_PERMISSION) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            if (resumed) conversation.start();
        } else error("대화하려면 마이크 권한이 필요해요. 기기 설정에서 Tikitaka의 마이크를 허용해주세요.");
    }
    @Override public void state(boolean active, String message) {
        talk.setText(active ? "대화 끝내기" : "대화 시작"); status.setText(message);
        if (active) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else { getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); friends.current = ""; friends.invalidate(); }
    }
    @Override public void caption(String who, String value) {
        speaker.setText(who.equals("user") ? "나" : who.equals("a") ? "민지 · AI" : "준호 · AI");
        caption.setText(value); friends.current = who; friends.invalidate();
    }
    @Override public void level(float value) { level.setProgress(Math.round(value * 100)); }
    @Override public void error(String message) { error.setText(message); error.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE); }

    private final class Friends extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        String current = "";
        Friends() { super(MainActivity.this); }
        @Override protected void onDraw(Canvas c) {
            float middle = getWidth() / 2f, y = dp(66), distance = Math.min(dp(65), getWidth() / 4f);
            friend(c, middle - distance, y, Color.rgb(219, 232, 196), "민지", current.equals("a"));
            friend(c, middle + distance, y, Color.rgb(248, 217, 197), "준호", current.equals("b"));
            paint.setColor(ink); paint.setAlpha(80);
            for (int x = -1; x <= 1; x++) c.drawCircle(middle + dp(x * 7), y, dp(1), paint);
            paint.setAlpha(255);
        }
        private void friend(Canvas c, float x, float y, int color, String name, boolean active) {
            float r = dp(32); paint.setColor(color); paint.setStyle(Paint.Style.FILL); c.drawCircle(x, y, r, paint);
            if (active) { paint.setColor(ink); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(2)); c.drawCircle(x, y, r + dp(5), paint); }
            paint.setStyle(Paint.Style.FILL); paint.setColor(ink);
            c.drawCircle(x - dp(9), y - dp(3), dp(2), paint); c.drawCircle(x + dp(9), y - dp(3), dp(2), paint);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(1.5f));
            c.drawArc(x - dp(5), y + dp(1), x + dp(5), y + dp(11), 0, 180, false, paint);
            paint.setStyle(Paint.Style.FILL); paint.setTextSize(dp(13)); paint.setTextAlign(Paint.Align.CENTER);
            c.drawText(name + "  AI", x, y + dp(55), paint);
        }
    }
}
