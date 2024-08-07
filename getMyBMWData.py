
import asyncio
import sys
import os
import json
from bimmer_connected.account import MyBMWAccount
from bimmer_connected.api.regions import Regions
from bimmer_connected.vehicle.vehicle import VehicleViewDirection
from bimmer_connected.vehicle.doors_windows import LockState
import pickle

async def main(email, password, vin, region):
    if (region == 'cn'):
        region = Regions.CHINA
    elif (region == 'us'):
        region = Regions.NORTH_AMERICA
    else:
        region = Regions.REST_OF_WORLD

    try:
        account = pickle.load(open('modules/MMM-MyBMW/account.p', 'rb'))
    except:
        account = MyBMWAccount(email, password, region)
        pickle.dump(account, open('modules/MMM-MyBMW/account.p', 'wb'))
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

region = 'rest'
if (len(sys.argv) > 4):
    region = sys.argv[4]
if (len(sys.argv) < 4):
    print('Usage: python getMyBMWData.py <email> <password> <vin> <region:us|cn|rest>')
else:
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], region))
