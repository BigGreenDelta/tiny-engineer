#pragma once

#include <Adafruit_SSD1306.h>

extern Adafruit_SSD1306 display;

// setRotation plus the panel offset that centres the layout on taller panels.
void setOledRotation(bool rotate180);
