# مختبر الكوكي المحلي (r8، r9)

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

## r9

ملفات منفصلة، وملفات r8 أعلاه بلا تغيير. الفرق: `401` بلا `Set-Cookie` أبدًا، والخروج يمسح الاسم الذي عمل به فقط، وخيار
اسم كوكي لكل دخول. السيناريوهات L5–L10 ونتائجها في [`../session-design-option-a.md`](../session-design-option-a.md) §8.4،
والنتائج الخام في `../evidence/cookie-lab-2026-11-19/`.

| الملف               | الدور                                                                                    |
| :------------------ | :--------------------------------------------------------------------------------------- |
| `server-r9.mjs`     | الخادم على `127.0.0.1:8788`. يلتزم عند الاستلام، ثم يؤخّر الرد ويسجّل وصوله أو غياب العميل |
| `page-r9.html`      | واجهة `lab` في الصفحة: الأقفال، `keepalive`، `BroadcastChannel`، مهلة الواجهة            |
| `run-chrome-r9.mjs` | Google Chrome عبر Playwright: L5–L10، وفيه تعطيل التبويب (L8) بـ`Page.crash`             |
| `run-webkit-r9.py`  | WebKitGTK: L5–L7 وL9–L10. L8 غير متاح عبر WebKitWebDriver                                |
| `summarize-r9.py`   | يستخرج الحقائق لكل تشغيل، ويتحقق من تطابقها داخل كل محرك                                 |

```sh
node server-r9.mjs &
node run-chrome-r9.mjs > chrome-run1.json      # من مجلد فيه node_modules/playwright (ESM لا يقرأ NODE_PATH)
DISPLAY=:99 python3 run-webkit-r9.py > webkit-run1.json
python3 summarize-r9.py chrome-run*.json webkit-run*.json
```
