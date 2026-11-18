# مختبر الكوكي المحلي (r8)

خادم محلي بجلسات **وهمية** يحاكي قواعد العقد للتدوير والخروج فقط، لاختبار سلوك جرّة الكوكي في المتصفح. **ليس مصادقة
AMBS** ولا يتصل بأي قاعدة أو خدمة. لا يدخل في بناء الموقع ولا في اختبارات القالب. التصميم والنتائج في
[`../session-design-option-a.md`](../session-design-option-a.md) §8.

| الملف            | الدور                                                             |
| :--------------- | :---------------------------------------------------------------- |
| `server.mjs`     | الخادم على `127.0.0.1:8787`. يلتزم عند استلام الطلب، ثم يؤخّر الرد |
| `page.html`      | السيناريوهات L1 وL2 وL4 داخل الصفحة                               |
| `run-chrome.mjs` | Google Chrome عبر Playwright، وفيه L3 بتبويبين                    |
| `run-webkit.py`  | WebKitGTK عبر WebKitWebDriver وSelenium، وفيه L3                  |
| `summarize.py`   | يستخرج الحقائق من نتائج التشغيل                                   |

التشغيل (Ubuntu 24.04، كما شُغّل في r8):

```sh
npm i playwright@1.63.0            # في مجلد منفصل عن المستودع
apt-get install webkit2gtk-driver xvfb
pip install selenium
node server.mjs &
node run-chrome.mjs > chrome.json
Xvfb :99 & DISPLAY=:99 WebKitWebDriver --port=4444 &
python3 run-webkit.py > webkit.json
python3 summarize.py chrome.json webkit.json
```

Firefox وPlaywright WebKit لم يُشغَّلا: تنزيل متصفحاتهما مرفوض من وكيل الشبكة في هذه البيئة. WebKitGTK ليس Safari ولا
iPhone.
