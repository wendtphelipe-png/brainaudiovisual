import sys
import os
import json
import urllib.request
import urllib.parse
import speech_recognition as sr

def transcribe_with_google(wav_path, r, language='pt-BR'):
    if not os.path.exists(wav_path):
        return ''
    try:
        with sr.AudioFile(wav_path) as source:
            # Noise adaptation for clear voice isolation
            r.adjust_for_ambient_noise(source, duration=0.12)
            audio = r.record(source)
            text = r.recognize_google(audio, language=language)
            return text.strip()
    except sr.UnknownValueError:
        return ''
    except Exception:
        # Fallback to general english/portuguese cross-check
        try:
            with sr.AudioFile(wav_path) as source:
                audio = r.record(source)
                fallback_lang = 'en-US' if language.startswith('pt') else 'pt-BR'
                text = r.recognize_google(audio, language=fallback_lang)
                return text.strip()
        except Exception:
            return ''

def transcribe_with_openai_whisper(wav_path, api_key, language='pt'):
    if not os.path.exists(wav_path) or not api_key:
        return None
    try:
        boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
        with open(wav_path, 'rb') as f:
            file_bytes = f.read()

        body = bytearray()
        # model
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n'.encode('utf-8'))
        # language
        lang_code = language.split('-')[0]
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{lang_code}\r\n'.encode('utf-8'))
        # file
        filename = os.path.basename(wav_path)
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: audio/wav\r\n\r\n'.encode('utf-8'))
        body.extend(file_bytes)
        body.extend(f'\r\n--{boundary}--\r\n'.encode('utf-8'))

        req = urllib.request.Request(
            'https://api.openai.com/v1/audio/transcriptions',
            data=body,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': f'multipart/form-data; boundary={boundary}'
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return (data.get('text') or '').strip()
    except Exception as e:
        sys.stderr.write(f'OpenAI Whisper error: {e}\n')
        return None

def transcribe_segments(manifest_path, default_lang='pt-BR'):
    if not os.path.exists(manifest_path):
        print(json.dumps({'error': f'Manifest not found: {manifest_path}'}))
        sys.exit(1)

    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    segment_files = data.get('segments', [])
    language = data.get('language', default_lang) or 'pt-BR'
    engine = data.get('engine', 'google') # 'google' | 'whisper' | 'gemini'
    openai_key = data.get('openaiApiKey', '')

    r = sr.Recognizer()
    r.energy_threshold = 280
    r.dynamic_energy_threshold = True

    # Auto-detection if language is 'auto'
    if language == 'auto':
        detected_lang = 'pt-BR'
        for item in segment_files[:4]:
            w_path = item['path']
            if not os.path.exists(w_path):
                continue
            try:
                with sr.AudioFile(w_path) as source:
                    r.adjust_for_ambient_noise(source, duration=0.10)
                    audio = r.record(source)
                    # Test common languages
                    for test_l in ['pt-BR', 'en-US', 'es-ES']:
                        try:
                            sample_text = r.recognize_google(audio, language=test_l)
                            if sample_text and len(sample_text.strip()) > 4:
                                detected_lang = test_l
                                break
                        except Exception:
                            pass
                    if detected_lang != 'pt-BR':
                        break
            except Exception:
                pass
        language = detected_lang
        sys.stderr.write(f'Auto-detected spoken audio language: {language}\n')

    results = {}

    for item in segment_files:
        seg_id = item['id']
        wav_path = item['path']
        if not os.path.exists(wav_path):
            results[str(seg_id)] = ''
            continue

        text = None

        # 1. Try Whisper if key provided
        if engine == 'whisper' and openai_key:
            text = transcribe_with_openai_whisper(wav_path, openai_key, language)

        # 2. Enhanced Google Web Speech (Free Default)
        if text is None:
            text = transcribe_with_google(wav_path, r, language)

        results[str(seg_id)] = (text or '').strip()

    print(json.dumps({'success': True, 'transcriptions': results}, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: transcribe.py <manifest_json_path> [language]'}))
        sys.exit(1)
    
    manifest = sys.argv[1]
    language_code = sys.argv[2] if len(sys.argv) > 2 else 'pt-BR'
    transcribe_segments(manifest, language_code)
