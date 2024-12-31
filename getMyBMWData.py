
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

# Load and store functions from bimmer_connected cli
def load_oauth_store_from_file(oauth_store: Path, account: MyBMWAccount) -> Dict:
    """Load the OAuth details from a file if it exists."""
    if not oauth_store.exists():
        return {}
    try:
        oauth_data = json.loads(oauth_store.read_text())
    except json.JSONDecodeError:
        return {}

    session_id_timestamp = oauth_data.pop("session_id_timestamp", None)
    # Pop session_id every 14 days so it gets recreated
    if (time.time() - (session_id_timestamp or 0)) > 14 * 24 * 60 * 60:
        oauth_data.pop("session_id", None)
        session_id_timestamp = None

    account.set_refresh_token(**oauth_data)

    return {**oauth_data, "session_id_timestamp": session_id_timestamp}


def store_oauth_store_to_file(
    oauth_store: Path, account: MyBMWAccount, session_id_timestamp: Optional[float] = None
) -> None:
    """Store the OAuth details to a file."""
    oauth_store.parent.mkdir(parents=True, exist_ok=True)
    oauth_store.write_text(
        json.dumps(
            {
                "refresh_token": account.config.authentication.refresh_token,
                "gcid": account.config.authentication.gcid,
                "access_token": account.config.authentication.access_token,
                "session_id": account.config.authentication.session_id,
                "session_id_timestamp": session_id_timestamp or time.time(),
            }
        ),
    )

async def main(email, password, vin, region='row', hcaptcha_token=None, oauth_store_path='modules/MMM-MyBMW/mybmw_auth.json'):
    if (region == 'cn'):
        region = Regions.CHINA
    elif (region == 'us'):
        region = Regions.NORTH_AMERICA
    else:
        region = Regions.REST_OF_WORLD

    account = MyBMWAccount(email, password, region, hcaptcha_token=hcaptcha_token)
    oauth_store_data = load_oauth_store_from_file(Path(oauth_store_path), account)

    await account.get_vehicles()
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
        'mileage': f'{vehicle.mileage.value} {vehicle.mileage.unit}',
        'doorLock': (vehicle.doors_and_windows.door_lock_state == LockState.LOCKED) or (vehicle.doors_and_windows.door_lock_state == LockState.SECURED),
        'fuelRange': f'{vehicle.fuel_and_battery.remaining_range_fuel.value} {vehicle.fuel_and_battery.remaining_range_fuel.unit}' if (vehicle.fuel_and_battery.remaining_range_fuel.value != None) else '',
        'electricRange': f'{vehicle.fuel_and_battery.remaining_range_electric.value} {vehicle.fuel_and_battery.remaining_range_electric.unit}' if (vehicle.fuel_and_battery.remaining_range_electric.value != None) else '',
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
if (len(sys.argv) < 4):
    print('Usage: python getMyBMWData.py <email> <password> <vin> <region:us|cn|rest (Optional)> <hCaptcha Token (Optional)> <OAuth2 Session Store Path (Optional)>')
else:
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], region, hcaptcha_token, oauth_store_path))
