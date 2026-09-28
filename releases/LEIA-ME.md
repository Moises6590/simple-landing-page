# Baixar o Lâmina Rubra

Os pacotes ficam na página de **Releases** do GitHub (arquivos grandes, sem limite de 100 MB):

- **Android:** https://github.com/Moises6590/simple-landing-page/releases/latest/download/LaminaRubra-Android.apk
- **Windows:** https://github.com/Moises6590/simple-landing-page/releases/latest/download/LaminaRubra-Windows.zip
- Todas as versões: https://github.com/Moises6590/simple-landing-page/releases

| Arquivo | Plataforma | Como instalar |
|---|---|---|
| `LaminaRubra-Android.apk` | Android 6+ | Abra no celular e permita "instalar apps de fontes desconhecidas". Instala por cima da versão anterior sem perder o progresso. |
| `LaminaRubra-Windows.zip` | Windows 10/11 | Extraia a pasta e abra `Lamina Rubra.exe` (deixe o `resources.neu` ao lado). |

Os pacotes são gerados automaticamente pelo GitHub Actions (`.github/workflows/pacotes.yml`) sempre que o número em `VERSION` muda.
O APK é assinado com uma chave de depuração fixa (`tools/android/signing/`): serve para instalar direto e atualizar por cima;
para publicar na Play Store é preciso gerar uma chave própria e guardá-la fora do repositório.
