package com.local2048.choice;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** A small, offline Android shell. All game assets are bundled in the APK. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView webView;
    private FrameLayout root;
    private int insetLeft, insetTop, insetRight, insetBottom;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#faf8ef"));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Keep the WebView behind the bars so the same gradient reaches every edge.
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                insetLeft = bars.left; insetTop = bars.top; insetRight = bars.right; insetBottom = bars.bottom;
            } else {
                insetLeft = insets.getSystemWindowInsetLeft(); insetTop = insets.getSystemWindowInsetTop();
                insetRight = insets.getSystemWindowInsetRight(); insetBottom = insets.getSystemWindowInsetBottom();
            }
            sendInsets();
            // Insets are applied to HTML content, never as an opaque border around it.
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new HostBridge(), "AndroidHost");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (isLocal(Uri.parse(url))) { sendInsets(); root.requestApplyInsets(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isLocal(url)) return null;
                String path = url.getPath();
                if (path == null || !path.startsWith("/assets/") || path.contains("..")) return missing();
                String asset = path.substring(8);
                try {
                    String mime = asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".html") ? "text/html" : "application/octet-stream";
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(asset));
                } catch (IOException error) { return missing(); }
            }
        });
        webView.loadUrl("https://" + HOST + "/assets/index.html");
    }
    private void sendInsets() {
        float density = getResources().getDisplayMetrics().density;
        String script = "(function(){var s=document.documentElement.style;";
        script += "s.setProperty('--safe-left','" + (insetLeft / density) + "px');";
        script += "s.setProperty('--safe-top','" + (insetTop / density) + "px');";
        script += "s.setProperty('--safe-right','" + (insetRight / density) + "px');";
        script += "s.setProperty('--safe-bottom','" + (insetBottom / density) + "px');";
        script += "})();";
        webView.evaluateJavascript(script, null);
    }
    private static boolean isLocal(Uri url) { return "https".equals(url.getScheme()) && HOST.equals(url.getHost()); }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
    }
    private final class HostBridge {
        @JavascriptInterface public void setThemeColour(String value, boolean light) {
            if (value == null || !value.matches("#[a-fA-F0-9]{6}")) return;
            runOnUiThread(() -> {
                int colour = Color.parseColor(value);
                root.setBackgroundColor(colour);
                if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                    int flags = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    getWindow().getInsetsController().setSystemBarsAppearance(light ? flags : 0, flags);
                } else {
                    int layout = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                    getWindow().getDecorView().setSystemUiVisibility(layout | (light ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0));
                }
            });
        }
        @JavascriptInterface public void exitApp() { runOnUiThread(() -> finish()); }
    }
    @Override public void onBackPressed() { webView.evaluateJavascript("window.gameBack && window.gameBack()", null); }
    @Override protected void onPause() {
        webView.evaluateJavascript("window.gamePause && window.gamePause()", null);
        webView.onPause();
        super.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override protected void onDestroy() { webView.removeJavascriptInterface("AndroidHost"); webView.destroy(); super.onDestroy(); }
}
