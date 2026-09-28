// Ajustes no projeto Android gerado pelo Capacitor:
// paisagem, aceleração por hardware, tela sempre acesa e modo imersivo (sem barras do sistema).
const fs = require('fs');
const path = require('path');
const main = path.join(__dirname, 'android/app/src/main');
const mf = path.join(main, 'AndroidManifest.xml');
let xml = fs.readFileSync(mf, 'utf8');
if (!xml.includes('screenOrientation')) {
  xml = xml.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="sensorLandscape"\n            android:hardwareAccelerated="true"');
  xml = xml.replace('<application', '<application\n        android:hardwareAccelerated="true"');
}
fs.writeFileSync(mf, xml);
const act = path.join(main, 'java/com/laminarubra/game/MainActivity.java');
fs.writeFileSync(act, `package com.laminarubra.game;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private void immersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`);
console.log('android: paisagem + imersivo + tela acesa');

// Assinatura fixa (a mesma dos pacotes anteriores: a versão nova instala por cima sem perder o progresso)
// e número de versão vindo de releases/VERSION.
const gradle = path.join(__dirname, 'android/app/build.gradle');
const build = (() => { try { return parseInt(fs.readFileSync(path.join(__dirname, '../../releases/VERSION'), 'utf8'), 10) || 1; } catch (_) { return 1; } })();
let g = fs.readFileSync(gradle, 'utf8').replace(/\n\/\/ lamina-rubra:início[\s\S]*\/\/ lamina-rubra:fim\n/, '\n');
g += `
// lamina-rubra:início
android {
    signingConfigs {
        debug {
            storeFile file('../../signing/lamina-debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    defaultConfig {
        versionCode ${build}
        versionName "build ${build}"
    }
}
// lamina-rubra:fim
`;
fs.writeFileSync(gradle, g);
console.log('android: assinatura fixa, versão ' + build);
