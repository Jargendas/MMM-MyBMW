
import asyncio
import sys
import os
import json
import time
from pathlib import Path
from typing import Dict, Optional
from bimmer_connected.account import MyBMWAccount
from bimmer_connected.api.regions import Regions
from bimmer_connected.vehicle.vehicle import VehicleViewDirection
from bimmer_connected.vehicle.doors_windows import LockState
from bimmer_connected.models import MyBMWAPIError, MyBMWAuthError, MyBMWCaptchaMissingError

# Load and store functions from bimmer_connected cli
def load_oauth_store_from_file(oauth_store: Path, account: MyBMWAccount) -> Dict:
    """Load the OAuth details from a file if it exists."""
    if not oauth_store.exists():
        return {}
    try:
        oauth_data = json.loads(oauth_store.read_text())
    except json.JSONDecodeError:
        return {}

    account.set_refresh_token(refresh_token=oauth_data["refresh_token"], gcid=oauth_data["gcid"])

    return oauth_data


def store_oauth_store_to_file(oauth_store: Path, account: MyBMWAccount, session_id_timestamp: Optional[float] = None) -> None:
    """Store the OAuth details to a file."""
    oauth_store.parent.mkdir(parents=True, exist_ok=True)    
    if (oauth_store.exists()): # Just update the refresh token
        try:
            oauth_data = json.loads(oauth_store.read_text())
        except json.JSONDecodeError:
            pass
        oauth_data["refresh_token"] = account.config.authentication.refresh_token
    else: # Create a new store
        oauth_data = {
                "refresh_token": account.config.authentication.refresh_token,
                "gcid": account.config.authentication.gcid
            }

    oauth_store.write_text(json.dumps(oauth_data))

def delete_oauth_store(oauth_store: Path) -> None:
    """Delete the OAuth details."""
    oauth_store.unlink(missing_ok=True)

async def main(email, password, vin, region='row', hcaptcha_token=None, oauth_store_path='modules/MMM-MyBMW/mybmw_auth.json', reset_on_auth_error=False):
    if (region == 'cn'):
        region = Regions.CHINA
    elif (region == 'us'):
        region = Regions.NORTH_AMERICA
    else:
        region = Regions.REST_OF_WORLD

    account = MyBMWAccount(email, password, region, hcaptcha_token=hcaptcha_token)
    oauth_store_data = load_oauth_store_from_file(Path(oauth_store_path), account)

    try:
        await account.get_vehicles()
    except MyBMWCaptchaMissingError as ex:
        print(json.dumps({'error': 'Missing captcha'}))
        sys.stdout.flush()
        return
    except MyBMWAuthError as ex:
        print(json.dumps({'error': 'Authentication error'}))
        sys.stdout.flush()
        if (reset_on_auth_error):
            delete_oauth_store(Path(oauth_store_path))
        return
    except (MyBMWAPIError, RequestError) as ex:
        print(json.dumps({'error': 'Connection error!'}))
        sys.stdout.flush()
        return

    vehicle = account.get_vehicle(vin)

    filename = 'modules/MMM-MyBMW/car-' + vin + '.png'
    if (not os.path.isfile(filename)):
        try:
            image_data = await vehicle.get_vehicle_image(VehicleViewDirection.FRONTSIDE)
            with open(filename, 'wb') as file:
                file.write(image_data)
                file.close()
        except Exception as e:
            print('Vehicle image could not be downloaded: ', e, file=sys.stderr)

    data = {
        'updateTime': vehicle.vehicle_location.vehicle_update_timestamp.isoformat(),
        'mileage': vehicle.mileage.value,
        'doorLock': (vehicle.doors_and_windows.door_lock_state == LockState.LOCKED) or (vehicle.doors_and_windows.door_lock_state == LockState.SECURED),
        'fuelRange': vehicle.fuel_and_battery.remaining_range_fuel.value if (vehicle.fuel_and_battery.remaining_range_fuel.value != None) else '',
        'electricRange': vehicle.fuel_and_battery.remaining_range_electric.value if (vehicle.fuel_and_battery.remaining_range_electric.value != None) else '',
        'chargingLevelHv': vehicle.fuel_and_battery.remaining_battery_percent,
        'connectorStatus': vehicle.fuel_and_battery.is_charger_connected,
        'vin': vehicle.vin,
        'imageUrl': filename
    }

    print(json.dumps(data))
    sys.stdout.flush()

    store_oauth_store_to_file(Path(oauth_store_path), account, oauth_store_data.get("session_id_timestamp"))

region = 'rest'
hcaptcha_token = None
oauth_store_path = 'modules/MMM-MyBMW/mybmw_auth.json'
if (len(sys.argv) > 4):
    region = sys.argv[4]
if (len(sys.argv) > 5):
    hcaptcha_token = sys.argv[5]
if (len(sys.argv) > 6):
    oauth_store_path = sys.argv[6]
if (len(sys.argv) > 7):
    reset_on_auth_error = sys.argv[7]
if (len(sys.argv) < 4):
    print('Usage: python getMyBMWData.py <email> <password> <vin> <region:us|cn|rest (Optional)> <hCaptcha Token (Optional)> <OAuth2 Session Store Path (Optional)> <Delete oauth store on error:0|1 (Optional)>')
else:
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], region, hcaptcha_token, oauth_store_path, reset_on_auth_error))
