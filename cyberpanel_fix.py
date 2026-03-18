import requests
import urllib3
import re
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

s = requests.Session()

def login():
    r = s.get('https://66.135.27.14:8090/', verify=False)
    csrftoken = s.cookies.get('csrftoken')
    if not csrftoken:
        match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', r.text)
        if match:
            csrftoken = match.group(1)
    
    print("Obtained CSRF Token:", csrftoken)
    
    data = {
        'username': 'admin',
        'password': 'Yl2IK9WEy7eXDj4u',
        'csrfmiddlewaretoken': csrftoken
    }
    
    headers = {
        'Referer': 'https://66.135.27.14:8090/',
        'Origin': 'https://66.135.27.14:8090'
    }
    
    res = s.post('https://66.135.27.14:8090/loginSystem/login', data=data, headers=headers, verify=False)
    print("Login Status:", res.status_code)
    return csrftoken

def check_file(csrftoken):
    payload = {
        'domain': 'thestoneset.com',
        'file': '/home/thestoneset.com/public_html/wp-config.php',
        'csrfmiddlewaretoken': csrftoken
    }
    headers = {
        'Referer': 'https://66.135.27.14:8090/filemanager/thestoneset.com',
        'Origin': 'https://66.135.27.14:8090'
    }
    res = s.post('https://66.135.27.14:8090/filemanager/dataLocal', data=payload, headers=headers, verify=False)
    print("File Content Response:", res.status_code)
    try:
        content = res.json()
        print("Data retrieved length:", len(content.get('data', '')))
        # Show first 200 chars
        print(content.get('data', '')[:300])
    except Exception as e:
        print("Failed to decode", e)
        print(res.text[:300])

if __name__ == "__main__":
    token = login()
    check_file(token)
