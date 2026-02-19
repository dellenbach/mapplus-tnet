<?php
	function detect_lang($accept_lang,$default_lang)
	{
		if (!$accept_lang)$accept_lang = array("de","fr","it","en");		
		
		
		// Detect HTTP_ACCEPT_LANGUAGE & HTTP_USER_AGENT.
		$_AL=strtolower($_SERVER['HTTP_ACCEPT_LANGUAGE']);
		$_UA=strtolower($_SERVER['HTTP_USER_AGENT']);
		
		// Try to detect Primary language if several languages are accepted.
		foreach((array)$accept_lang as $K) {
		   if(strpos($_AL, $K)===0)
		   return $K;
		}
		
		// Try to detect any language if not yet detected.
		foreach((array)$accept_lang as $K){
		   if(strpos($_AL, $K)!==false)
		   return $K;
		}
		
		foreach((array)$accept_lang as $K) {
		if(strpos($_UA, $K)!==false)
		return $K;
		}
		
		// Return default language if language is not yet detected.
		return $default_lang;
	}
?>