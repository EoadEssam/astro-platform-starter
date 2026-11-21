# يشغّل السيناريوهات نفسها في WebKitGTK عبر WebKitWebDriver (Selenium). ليس Safari ولا iPhone.
import json, os, sys, time
from selenium import webdriver
BASE = 'http://127.0.0.1:%s/' % os.environ.get('PORT', '8787')
opts = webdriver.WebKitGTKOptions()
opts.binary_location = '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser'
opts.add_argument('--automation')
d = webdriver.Remote(command_executor='http://127.0.0.1:4444', options=opts)  # WebKitWebDriver على Xvfb
d.set_script_timeout(30)
def call(expr):
    return d.execute_async_script("const done=arguments[arguments.length-1];Promise.resolve(%s).then(done,e=>done({error:String(e)}))" % expr)
def fresh():
    d.delete_all_cookies(); d.get(BASE); call('lab.reset()')
caps = d.capabilities
out = {'engine': 'webkit', 'browser': '%s %s' % (caps.get('browserName'), caps.get('browserVersion')), 'driver': 'selenium+WebKitWebDriver', 'runs': {}}
for key, expr in [('L1','lab.L1()'),('L2a','lab.L2a()'),('L2b_401_clear','lab.L2_401(false)'),('L2c_401_noclear','lab.L2_401(true)'),('L4a','lab.L4a()'),('L4b','lab.L4b()')]:
    fresh(); r = call(expr); r['serverLog'] = call('lab.log()'); out['runs'][key] = r
fresh(); A = d.current_window_handle
call('lab.signin()'); call("lab.startSwitch('a',1500)"); time.sleep(0.3)
d.switch_to.new_window('tab'); B = d.current_window_handle; d.get(BASE)
call("lab.startSwitch('b',0)"); tb = call("lab.wait('b')"); wb1 = call('lab.who()')
d.switch_to.window(A); ta = call("lab.wait('a')")
d.switch_to.window(B); wb2 = call('lab.who()')
out['runs']['L3'] = {'tabA_switch': ta, 'tabB_switch': tb, 'tabB_whoBefore': wb1, 'tabB_whoAfter': wb2, 'serverLog': call('lab.log()')}
d.quit()
print(json.dumps(out, indent=1, ensure_ascii=False))
