# سيناريوهات r9 في WebKitGTK عبر WebKitWebDriver (Selenium). ليس Safari ولا iPhone.
# نافذتان في جلسة WebDriver واحدة = جرّة كوكي واحدة. تعطيل التبويب (L8) غير متاح عبر WebDriver، فلا يُشغَّل.
import json, os, sys, time
from selenium import webdriver

BASE = 'http://127.0.0.1:%s/' % os.environ.get('PORT', '8788')
opts = webdriver.WebKitGTKOptions()
opts.binary_location = '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser'
opts.add_argument('--automation')
d = webdriver.Remote(command_executor='http://127.0.0.1:4444', options=opts)
d.set_script_timeout(30)
caps = d.capabilities
out = {'engine': 'webkit', 'browser': '%s %s' % (caps.get('browserName'), caps.get('browserVersion')), 'driver': 'selenium+WebKitWebDriver', 'runs': {}}


def step(name):
    print(time.strftime('%H:%M:%S'), name, file=sys.stderr, flush=True)


def call(expr):
    return d.execute_async_script(
        "const done=arguments[arguments.length-1];Promise.resolve(%s).then(done,e=>done({error:String(e)}))" % expr)


def fresh(n):
    # يغلق كل النوافذ عدا واحدة، يمسح الكوكي، ويفتح n نافذة على الصفحة
    handles = d.window_handles
    for h in handles[1:]:
        d.switch_to.window(h)
        d.close()
    d.switch_to.window(d.window_handles[0])
    d.delete_all_cookies()
    d.get(BASE)
    call('lab.reset()')
    tabs = [d.current_window_handle]
    for _ in range(n - 1):
        d.switch_to.new_window('tab')
        d.get(BASE)
        tabs.append(d.current_window_handle)
    d.switch_to.window(tabs[0])
    return tabs


def on(tab):
    d.switch_to.window(tab)


fresh(1)
out['features'] = call('lab.features()')

step('L5')
(A,) = fresh(1)
call("lab.signin(false,'s1')")
w1 = call('lab.who()')
call('lab.expire(%s)' % json.dumps(list(w1['body']['cookies'].values())[0]))
call("lab.start('late401','who',1500)")
time.sleep(0.3)
call("lab.signin(false,'s2')")
wa = call('lab.who()')
late = call("lab.wait('late401')")
wl = call('lab.who()')
out['runs']['L5_late401_noclear'] = {'whoAfterSignin': wa, 'late': late, 'whoAfterLate': wl, 'serverLog': call('lab.log()')}


def L6(variant):
    step('L6 ' + variant)
    named = 'true' if variant == 'named' else 'false'
    A, B = fresh(2)
    on(A)
    call("lab.signin(%s,'s1')" % named)
    call("lab.start('so','signout',1500,{lock:%s})" % ('true' if variant == 'locks' else 'false'))
    time.sleep(0.3)
    on(B)
    t0 = time.time()
    sb = call("lab.signinLocked(%s,'s2')" % named) if variant == 'locks' else call("lab.signin(%s,'s2')" % named)
    waited = int((time.time() - t0) * 1000)
    wb1 = call('lab.who()')
    on(A)
    so = call("lab.wait('so')")
    on(B)
    wb2 = call('lab.who()')
    return {'variant': variant, 'signinB': sb, 'signinBWaitedMs': waited, 'whoBBefore': wb1, 'signoutA': so, 'whoBAfter': wb2, 'serverLog': call('lab.log()')}


out['runs']['L6a_two_tabs_no_coordination'] = L6('none')
out['runs']['L6b_two_tabs_web_locks'] = L6('locks')
out['runs']['L6c_two_tabs_cookie_per_signin'] = L6('named')


def L7(keepalive):
    step('L7 close keepalive=%s' % keepalive)
    A, B = fresh(2)
    on(A)
    call("lab.signin(false,'s1')")
    call("lab.start('so','signout',2000,{lock:true,keepalive:%s})" % ('true' if keepalive else 'false'))
    time.sleep(0.3)
    d.close()  # يغلق نافذة A
    on(B)
    t0 = time.time()
    sb = call("lab.signinLocked(false,'s2')")
    waited = int((time.time() - t0) * 1000)
    wb1 = call('lab.who()')
    time.sleep(2.6)
    wb2 = call('lab.who()')
    return {'how': 'close', 'keepalive': keepalive, 'signinB': sb, 'signinBWaitedMs': waited, 'whoBBefore': wb1, 'whoBAfter': wb2, 'serverLog': call('lab.log()')}


out['runs']['L7a_close_tab_during_signout'] = L7(False)
out['runs']['L7b_close_tab_during_signout_keepalive'] = L7(True)
out['runs']['L8_crash'] = {'not_run': 'tab crash is not available through WebKitWebDriver'}

step('L9')
(A,) = fresh(1)
call("lab.signin(false,'s1')")
before = call('lab.who()')
first = call('lab.switchWithUiTimeout(1500,300)')
wr = call('lab.who()')
time.sleep(1.7)
late = call("lab.wait('uitimeout')")
wl = call('lab.who()')
out['runs']['L9_ui_timeout_without_abort'] = {'before': before, 'first': first, 'whoRightAfterUiTimeout': wr, 'late': late, 'whoLater': wl, 'serverLog': call('lab.log()')}


def L10(keepalive):
    step('L10 keepalive=%s' % keepalive)
    A, B = fresh(2)
    on(A)
    call("lab.signin(false,'s1')")
    call("lab.start('so','signout',2000,{announce:true,keepalive:%s})" % ('true' if keepalive else 'false'))
    time.sleep(0.3)
    d.close()
    on(B)
    b = call("lab.signinAfterBroadcast(false,'s2',800)")
    wb1 = call('lab.who()')
    time.sleep(2.2)
    wb2 = call('lab.who()')
    return {'keepalive': keepalive, 'b': b, 'whoBBefore': wb1, 'whoBAfter': wb2, 'serverLog': call('lab.log()')}


out['runs']['L10a_broadcast_only_close'] = L10(False)
out['runs']['L10b_broadcast_only_close_keepalive'] = L10(True)

d.quit()
print(json.dumps(out, indent=1, ensure_ascii=False))
