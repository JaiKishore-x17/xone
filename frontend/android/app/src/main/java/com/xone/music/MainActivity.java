package com.xone.music;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    public interface BlePermissionCallback {
        void onResult(boolean granted);
    }

    private static final int REQUEST_CODE_BLE_PERMISSIONS = 4109;
    private BlePermissionCallback pendingBlePermissionCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(XoneAudioPlugin.class);
        registerPlugin(XoneJamPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            }
            WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (insetsController != null) {
                insetsController.setAppearanceLightStatusBars(false);
                insetsController.setAppearanceLightNavigationBars(false);
            }
        }
    }

    public String[] getRequiredBlePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return new String[] {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            };
        }
        return new String[] {
            Manifest.permission.ACCESS_FINE_LOCATION
        };
    }

    public boolean hasBlePermissions() {
        for (String perm : getRequiredBlePermissions()) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    public void ensureBlePermissions(@NonNull BlePermissionCallback callback) {
        if (hasBlePermissions()) {
            callback.onResult(true);
            return;
        }

        List<String> missing = new ArrayList<>();
        for (String perm : getRequiredBlePermissions()) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                missing.add(perm);
            }
        }

        if (missing.isEmpty()) {
            callback.onResult(true);
            return;
        }

        if (pendingBlePermissionCallback != null) {
            pendingBlePermissionCallback.onResult(false);
        }
        pendingBlePermissionCallback = callback;
        ActivityCompat.requestPermissions(
            this,
            missing.toArray(new String[0]),
            REQUEST_CODE_BLE_PERMISSIONS
        );
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        @NonNull String[] permissions,
        @NonNull int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CODE_BLE_PERMISSIONS && pendingBlePermissionCallback != null) {
            BlePermissionCallback callback = pendingBlePermissionCallback;
            pendingBlePermissionCallback = null;
            boolean granted = grantResults.length > 0 && hasBlePermissions();
            callback.onResult(granted);
        }
    }
}
