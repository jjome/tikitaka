package com.jjome.tikitaka;

import android.Manifest;
import android.app.Application;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public class MainActivityTest {
    private List<View> descendants(View root) {
        List<View> result = new ArrayList<>(); result.add(root);
        if (root instanceof ViewGroup group) for (int i = 0; i < group.getChildCount(); i++) result.addAll(descendants(group.getChildAt(i)));
        return result;
    }
    @Test public void initialProductScreenHasOneStartButtonAndNoTextInput() {
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            List<View> all = descendants(controller.get().getWindow().getDecorView());
            List<View> buttons = all.stream().filter(v -> v instanceof Button).toList();
            assertEquals(1, buttons.size()); assertEquals("대화 시작", ((Button)buttons.get(0)).getText().toString());
            assertFalse(all.stream().anyMatch(v -> v instanceof android.widget.EditText || v instanceof android.widget.Spinner));
        }
    }
    @Test public void deniedPermissionKeepsStartAvailableAndExplainsRecovery() {
        Shadows.shadowOf((Application)RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.RECORD_AUDIO);
        try (ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            activity.onRequestPermissionsResult(10, new String[]{Manifest.permission.RECORD_AUDIO}, new int[]{-1});
            List<View> all = descendants(activity.getWindow().getDecorView());
            assertTrue(all.stream().anyMatch(v -> v instanceof TextView t && t.getText().toString().contains("마이크 권한이 필요")));
            Button button = (Button)all.stream().filter(v -> v instanceof Button).findFirst().get();
            assertTrue(button.isEnabled()); assertEquals("대화 시작", button.getText().toString());
        }
    }
}
