# toast on CEF — macOS-only for now.
# Derived from the cefsimple CMakeLists (BSD license, CEF Authors).
# This file must be added to the CEF binary distribution tree as
# tests/ceftoast — see build.sh.

#
# Source files.
#

set(TOAST_SRCS
  toast_app.cc
  toast_app.h
  toast_downloads.cc
  toast_downloads.h
  toast_handler.cc
  toast_handler.h
  toast_scheme.cc
  toast_scheme.h
  toast_settings.cc
  toast_settings.h
  toast_tabs.cc
  toast_tabs.h
  toast_updater.h
  )
set(TOAST_SRCS_MAC
  toast_mac.mm
  toast_handler_mac.mm
  toast_updater.mm
  )
APPEND_PLATFORM_SOURCES(TOAST_SRCS)
source_group(ceftoast FILES ${TOAST_SRCS})

set(TOAST_HELPER_SRCS_MAC
  process_helper_mac.cc
  )
APPEND_PLATFORM_SOURCES(TOAST_HELPER_SRCS)
source_group(ceftoast FILES ${TOAST_HELPER_SRCS})

set(TOAST_RESOURCES_MAC_SRCS_MAC
  mac/Info.plist.in
  mac/toast.icns
  )
APPEND_PLATFORM_SOURCES(TOAST_RESOURCES_MAC_SRCS)
source_group(ceftoast\\mac FILES ${TOAST_RESOURCES_MAC_SRCS})

set(TOAST_RESOURCES_MAC_ENGLISH_LPROJ_SRCS_MAC
  mac/English.lproj/InfoPlist.strings
  mac/English.lproj/MainMenu.xib
  )
APPEND_PLATFORM_SOURCES(TOAST_RESOURCES_MAC_ENGLISH_LPROJ_SRCS)
source_group(ceftoast\\mac\\English.lproj FILES ${TOAST_RESOURCES_MAC_ENGLISH_LPROJ_SRCS})

set(TOAST_WEB_SRCS
  resources/dltoast.html
  resources/newtab.html
  resources/setup.html
  resources/switcher.html
  )

set(TOAST_RESOURCES_SRCS
  ${TOAST_RESOURCES_MAC_SRCS}
  ${TOAST_RESOURCES_MAC_ENGLISH_LPROJ_SRCS}
  ${TOAST_WEB_SRCS}
  )


#
# Shared configuration.
#

set(CEF_TARGET "toast")
if(OS_MAC)
  set(CEF_HELPER_TARGET "toast_Helper")
  set(CEF_HELPER_OUTPUT_NAME "toast Helper")
else()
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
endif()

SET_CEF_TARGET_OUT_DIR()


#
# macOS configuration.
#

if(OS_MAC)
  option(OPTION_USE_ARC "Build with ARC (automatic Reference Counting) on macOS." ON)
  if(OPTION_USE_ARC)
    list(APPEND CEF_COMPILER_FLAGS
      -fobjc-arc
      )
    set_target_properties(${target} PROPERTIES
      CLANG_ENABLE_OBJC_ARC "YES"
      )
  endif()

  set(CEF_APP "${CEF_TARGET_OUT_DIR}/${CEF_TARGET}.app")

  set(EXECUTABLE_NAME "${CEF_TARGET}")
  set(PRODUCT_NAME "${CEF_TARGET}")

  add_executable(${CEF_TARGET} MACOSX_BUNDLE ${TOAST_RESOURCES_SRCS} ${TOAST_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(${CEF_TARGET})
  add_dependencies(${CEF_TARGET} libcef_dll_wrapper)
  target_link_libraries(${CEF_TARGET} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
  set_target_properties(${CEF_TARGET} PROPERTIES
    MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in
    )

  COPY_MAC_FRAMEWORK("${CEF_TARGET}" "${CEF_BINARY_DIR}" "${CEF_APP}")

  # Helper app bundles (renderer, GPU, alerts, plugin processes).
  foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
    string(REPLACE ":" ";" _suffix_list ${_suffix_list})
    list(GET _suffix_list 0 _name_suffix)
    list(GET _suffix_list 1 _target_suffix)
    list(GET _suffix_list 2 _plist_suffix)

    set(_helper_target "${CEF_HELPER_TARGET}${_target_suffix}")
    set(_helper_output_name "${CEF_HELPER_OUTPUT_NAME}${_name_suffix}")

    set(_helper_info_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" _plist_contents)
    string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_output_name}" _plist_contents ${_plist_contents})
    string(REPLACE "\${PRODUCT_NAME}" "${_helper_output_name}" _plist_contents ${_plist_contents})
    string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist_contents ${_plist_contents})
    file(WRITE ${_helper_info_plist} ${_plist_contents})

    add_executable(${_helper_target} MACOSX_BUNDLE ${TOAST_HELPER_SRCS})
    SET_EXECUTABLE_TARGET_PROPERTIES(${_helper_target})
    add_dependencies(${_helper_target} libcef_dll_wrapper)
    target_link_libraries(${_helper_target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${_helper_target} PROPERTIES
      MACOSX_BUNDLE_INFO_PLIST ${_helper_info_plist}
      OUTPUT_NAME ${_helper_output_name}
      )

    add_dependencies(${CEF_TARGET} "${_helper_target}")

    add_custom_command(
      TARGET ${CEF_TARGET}
      POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
              "${CEF_TARGET_OUT_DIR}/${_helper_output_name}.app"
              "${CEF_APP}/Contents/Frameworks/${_helper_output_name}.app"
      VERBATIM
      )
  endforeach()

  # Prefixes stripped when copying into Contents/Resources.
  set(PREFIXES "mac/" "resources/")
  COPY_MAC_RESOURCES("${TOAST_RESOURCES_SRCS}" "${PREFIXES}" "${CEF_TARGET}" "${CMAKE_CURRENT_SOURCE_DIR}" "${CEF_APP}")
endif()
