// Posts a real mouse click (or a move, with "move") at screen points, for screenshots of Photoshop's dialogs:
//   osascript -l JavaScript click.js <x> <y> [move]   (needs Accessibility permission for the terminal)

ObjC.import('CoreGraphics');
function run(argv) {
  var x = parseFloat(argv[0]), y = parseFloat(argv[1]);
  var p = $.CGPointMake(x, y);
  var move = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, move);
  delay(0.05);
  if (argv[2] === "move") return "moved";
  var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, p, $.kCGMouseButtonLeft);
  var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, p, $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, down); delay(0.05); $.CGEventPost($.kCGHIDEventTap, up);
  return "clicked " + x + "," + y;
}
