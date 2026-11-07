# Ice-bank controller (for scale-up)

`ice_bank_controller/` is the controller for the full-size design: solar compressor → ice bank →
water pump → radiator. It has the same offline buffer, 4G, clock, watchdogs and OTA updates as
the Peltier prototype controller in `../harvest_hold_controller/`.

The prototype uses Peltier modules because the ice bank is too expensive to build at this stage.
When you scale up, use this controller and set the room's `cooling_type` to `ice_bank` in the
backend. The app then shows the ice bank, pump and ice maker instead of the Peltier cooler.
